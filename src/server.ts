import * as express from "express";
import * as request from "request-promise-native";
import * as fs from "fs-extra";
import * as os from "os";
import * as http from "http";
import * as path from "path";
import * as url from "url";
import * as ini from "ini";
import {Norman} from "./norman";
import * as utils from "./utils";
import chalk from "chalk";
import * as contentType from "content-type";
import * as crypto from "crypto";
import {ModuleInfo} from "./module-info";
import {Base} from "./base";
import {PACK_TAG} from "./module-state-manager";

const accept = require("accept");


const NPM_SERVER_PORT = 5001;

const TEMP_DIR = "/tmp/norman";
const TARBALL_CACHE_DIR = "/tmp/norman-cache";


export type NpmConfig = {
  registries: { [prefix: string]: string };
  tokens: { [domain: string]: string };
  other: { [key: string]: any };
};


export interface ModuleInfoWithDeps {
  module: ModuleInfo;
  dependencies: ModuleInfo[];
}


export class LocalNpmServer extends Base {
  protected app: express.Application;
  protected npmConfig!: NpmConfig;
  protected myServerAddress: string;
  protected port: number;
  protected server: http.Server | null = null;


  public constructor(norman: Norman, port: number = NPM_SERVER_PORT) {
    super(norman);

    this.port = port;
    this.myServerAddress = `http://localhost:${port}`;

    this.app = express();

    this.app.get("/tarballs/:package", (req, res) => {
      // tslint:disable-next-line no-floating-promises
      this.onGetTarball(req.params.package, req, res);
    });

    this.app.get("/tarballs/:org/:package", (req, res) => {
      // tslint:disable-next-line no-floating-promises
      this.onGetTarball(`${req.params.org}/${req.params.package}`, req, res);
    });

    this.app.get("/:package", (req, res) => {
      // tslint:disable-next-line no-floating-promises
      this.onGetPackage(req.params.package, req, res);
    });

    this.app.get("/:org/:package", (req, res) => {
      // tslint:disable-next-line no-floating-promises
      this.onGetPackage(`${req.params.org}/${req.params.package}`, req, res);
    });
  }


  public async start(): Promise<void> {
    this.npmConfig = this.loadNpmConfig(this.config.mainConfigDir, ".npmrc");

    this.server = this.app.listen(NPM_SERVER_PORT);

    console.log(`Local npm server listening on ${NPM_SERVER_PORT}`);
  }


  public async stop(): Promise<void> {
    return new Promise<void>(resolve => {
      if (this.server) {
        this.server.close(() => {
          resolve();
        });
      }
    });
  }


  protected async onGetPackage(packageName: string, req: express.Request, res: express.Response): Promise<void> {
    let localModule = this.config.modules.find(module => module.name === packageName);
    if (localModule) {
      let acceptedTypes: string[] = accept.mediaTypes(req.headers.accept);
      if (acceptedTypes.length && acceptedTypes[0] === "application/vnd.npm.install-v1+json") {
        let packument = await this.getLocalModuleAbbrPackument(localModule);
        res.set("content-type", acceptedTypes[0]);
        res.send(JSON.stringify(packument));
      } else {
        let packument = await this.getLocalModulePackument(localModule);
        res.set("content-type", "application/json");
        res.send(JSON.stringify(packument));
      }
    } else {
      try {
        let registry = this.getRegistryForPackage(packageName);

        let headers = Object.assign({}, req.headers, { host: url.parse(registry).host });

        let token = this.getTokenForUrl(registry);
        if (token) {
          headers.authorization = `Bearer ${token}`;
        }

        if (registry.endsWith("/")) {
          registry = registry.slice(0, -1);
        }

        let response = await request.get(`${registry}/${packageName}`, {
          headers,
          resolveWithFullResponse: true,
          gzip: true
        });

        let parsedContentType = contentType.parse(response.headers["content-type"]);
        if (parsedContentType.type === "application/vnd.npm.install-v1+json" || parsedContentType.type === "application/json") {
          let json = JSON.parse(response.body);
          for (let version of Object.keys(json.versions || { })) {
            let versionObject = json.versions[version];
            if (versionObject.dist && versionObject.dist.tarball) {
              versionObject.dist.tarball = `${this.myServerAddress}/tarballs/${encodeURIComponent(packageName)}?url=${encodeURIComponent(versionObject.dist.tarball)}`;
            }
          }

          let responseHeaders = { ... response.headers };
          delete responseHeaders["content-encoding"];
          delete responseHeaders["transfer-encoding"];

          res.set(responseHeaders).send(JSON.stringify(json));
        } else {
          res.set(response.headers).send(response.body);
        }
      } catch (error) {
        if (error.statusCode) {
          res.status(error.statusCode).set(error.response.headers).send(error.response.body);
        } else {
          res.status(500).send("Internal error: " + error.message);
          console.log(`error while fetching package info ${packageName}: ${error}`);
        }
      }
    }
  }


  protected getRegistryForPackage(packageName: string): string {
    let org = packageName.startsWith("@") ? packageName.slice(0, packageName.indexOf("/")) : "";
    let result = org ? this.npmConfig.registries[org] || this.npmConfig.registries.default : this.npmConfig.registries.default;
    if (!result) {
      throw new Error(`Npm registry for package ${packageName} not found`);
    }
    return result;
  }


  protected getTokenForUrl(registryUrl: string): string | null {
    let parsedUrl = url.parse(registryUrl);
    if (parsedUrl.host) {
      return this.npmConfig.tokens[parsedUrl.host] || null;
    }
    return null;
  }


  protected async getLocalModulePackument(module: ModuleInfo): Promise<any> {
    return this.getLocalModuleAbbrPackument(module);
  }


  protected async getLocalModuleAbbrPackument(module: ModuleInfo): Promise<any> {
    let moduleMeta = fs.readJSONSync(path.join(module.path, "package.json"));
    let moduleVersion: string = moduleMeta.version;

    let versionObject: any = {
      name: module.name,
      version: moduleVersion,
      directories: { },
      _hasShrinkwrap: false,
      dist: {
        tarball: `${this.myServerAddress}/tarballs/${module.name}`
      }
    };

    for (let key of [ "dependencies", "devDependencies", "optionalDependencies", "bundleDependencies", "peerDependencies", "bin", "engines" ]) {
      if (moduleMeta[key]) {
        versionObject[key] = moduleMeta[key];
      }
    }

    return {
      name: module.name,
      modified: new Date().toString(),
      "dist-tags": {
        latest: moduleVersion
      },
      versions: {
        [moduleVersion]: versionObject
      }
    };
  }


  protected async onGetTarball(packageName: string, req: express.Request, res: express.Response): Promise<void> {
    let localModule = this.config.modules.find(module => module.name === packageName);
    if (localModule) {
      try {
        let stateManager = localModule.createStateManager();
        let actualState = await stateManager.loadActualState();
        let stateHash = stateManager.getStateHash(actualState);

        let archivePath: string;

        let packagedDirPath = path.join(TEMP_DIR, `${packageName}-${stateHash}`);

        let packager = localModule.createPackager();
        if (fs.existsSync(packagedDirPath)) {
          archivePath = packager.getArchivePathFromDir(packagedDirPath);
        } else {
          archivePath = await packager.pack(stateHash);

          await stateManager.saveActualState(PACK_TAG);
        }

        res.sendFile(archivePath);
      } catch (error) {
        console.error(error);
      }
    } else {
      try {
        let cachedFileName = this.getCachedTarballPath(req.query.url);
        if (cachedFileName) {
          res.sendFile(cachedFileName);
          return;
        }

        let headers = Object.assign({}, req.headers, { host: url.parse(req.query.url).host });

        let token = this.getTokenForUrl(req.query.url);
        if (token) {
          headers.authorization = `Bearer ${token}`;
        }

        let response = await request.get(req.query.url, {
          headers,
          resolveWithFullResponse: true,
          encoding: null
        });

        this.cacheTarball(req.query.url, response.body);

        res.status(response.statusCode).set(response.headers).send(response.body);
      } catch (error) {
        if (error.statusCode) {
          res.status(error.statusCode).set(error.response.headers).send(error.response.body);
        } else {
          res.status(500).set(error.headers).send(error.body);
          console.log(`error while proxying URL ${req.query.url}: ${error}`);
        }
      }
    }
  }


  protected pathForCachedTarball(tarballUrl: string): string {
    return path.join(TARBALL_CACHE_DIR, crypto.createHmac("sha256", "norman").update(tarballUrl).digest("hex"));
  }


  protected getCachedTarballPath(tarballUrl: string): string | null {
    let cachedPath = this.pathForCachedTarball(tarballUrl);
    return fs.existsSync(cachedPath) ? cachedPath : null;
  }


  protected cacheTarball(tarballUrl: string, data: Buffer): void {
    fs.mkdirpSync(TARBALL_CACHE_DIR);
    fs.writeFileSync(this.pathForCachedTarball(tarballUrl), data);
  }


  public buildNpmEnv(module: ModuleInfo): NodeJS.ProcessEnv {
    let result = process.env;

    for (let key of Object.keys(this.npmConfig.registries)) {
      if (key !== "default") {
        result[`npm_config_${key}:registry`] = this.myServerAddress;
      }
    }

    result["npm_config_package-lock"] = "false";

    return result;
  }


  protected loadNpmConfig(dir: string, projectConfigFileName: string): NpmConfig {
    const loadNpmrc = (filename: string): NpmConfig => {
      let npmrcText = "";
      try {
        npmrcText = fs.readFileSync(filename, { encoding: "utf-8" });
        console.log(`Loaded npm config from ${filename}`);
      } catch (error) {
        if (error.code !== "ENOENT") {
          console.log(chalk.red(`Failed to load npm config file ${filename}: ${error.message}`));
        }

        return {
          registries: { },
          tokens: { },
          other: { }
        };
      }

      let parsedConfig = ini.parse(npmrcText);
      let npmConfig: NpmConfig = {
        registries: { },
        tokens: { },
        other: { }
      };

      for (let key of Object.keys(parsedConfig)) {
        if (key === "registry") {
          npmConfig.registries.default = parsedConfig[key];
        } else if (key.endsWith(":registry")) {
          npmConfig.registries[key.slice(0, key.indexOf(":"))] = parsedConfig[key];
        } else if (key.endsWith(":_authToken")) {
          let registryUrl = key.slice(0, -":_authToken".length);
          if (registryUrl.startsWith("//")) {
            registryUrl = "http:" + registryUrl;
          }

          let parsedUrl = url.parse(registryUrl);
          if (parsedUrl.host) {
            npmConfig.tokens[parsedUrl.host] = parsedConfig[key];
          }
        } else {
          npmConfig.other[key] = parsedConfig[key];
        }
      }

      return npmConfig;
    };

    let projectConfig = loadNpmrc(path.join(dir, projectConfigFileName));
    let profileConfig = loadNpmrc(path.join(os.homedir(), ".npmrc"));

    return {
      registries: Object.assign(profileConfig.registries, projectConfig.registries),
      tokens: Object.assign(profileConfig.tokens, projectConfig.tokens),
      other: Object.assign(profileConfig.tokens, projectConfig.tokens)
    };
  }


  public async installModuleDeps(installTo: ModuleInfo): Promise<void> {
    await utils.cleanNpmCache();

    let npmEnv = this.buildNpmEnv(installTo);

    await utils.runCommand("npm", [ "install" ], {
      cwd: installTo.path,
      env: npmEnv
    });

    await utils.runCommand("npm", [ "prune" ], {
      cwd: installTo.path,
      env: npmEnv
    });

    await utils.cleanNpmCache();
  }


  public static cleanCache(): void {
    fs.removeSync(TARBALL_CACHE_DIR);
  }
}
