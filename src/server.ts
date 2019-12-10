import * as express from "express";
import * as request from "request-promise-native";
import * as fs from "fs-extra";
import * as os from "os";
import * as http from "http";
import * as path from "path";
import * as url from "url";
import * as ini from "ini";
import * as utils from "./utils";
import * as chalk from "chalk";
import * as contentType from "content-type";
import * as crypto from "crypto";
import { ModuleInfo } from "./module-info";
import { PACK_TAG } from "./module-state-manager";
import { AddressInfo } from "net";
import { getConfig } from "./config";
import { ServiceLocator } from "./locator";
import { getNpmRc } from "./npmrc";
import { Lockfile } from "./lockfile";
import { ModulePackager } from "./module-packager";


const accept = require("accept");


const TEMP_DIR = path.join(os.tmpdir(), "norman");
const TARBALL_CACHE_DIR = path.join(os.tmpdir(), "norman-cache");


export interface ModuleInfoWithDeps {
  module: ModuleInfo;
  dependencies: ModuleInfo[];
}


export class LocalNpmServer {
  protected app: express.Application;
  protected port?: number;
  protected server: http.Server | null = null;


  protected constructor() {
    this.app = express();

    this.app.get("/tarballs/:package", (req, res) => {
      // tslint:disable-next-line no-floating-promises
      this.onGetTarball(req.params.package, req, res);
    });

    this.app.get("/tarballs/:org/:package", (req, res) => {
      // tslint:disable-next-line no-floating-promises
      this.onGetTarball(`${ req.params.org }/${ req.params.package }`, req, res);
    });

    this.app.get("/:package", (req, res) => {
      // tslint:disable-next-line no-floating-promises
      this.onGetPackage(req.params.package, req, res);
    });

    this.app.get("/:org/:package", (req, res) => {
      // tslint:disable-next-line no-floating-promises
      this.onGetPackage(`${ req.params.org }/${ req.params.package }`, req, res);
    });
  }


  public get myServerAddress() {
    if (this.port == null) {
      throw new Error("Cannot get npm server address: server not started yet");
    } else {
      return `http://localhost:${ this.port }`;
    }
  }


  public async start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server = this.app.listen(0, () => {
        this.port = (this.server!.address() as AddressInfo).port;
        console.log(`Local npm server listening on ${ this.port }`);
        resolve();
      });
    });
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
    const config = getConfig();

    let localModule = config.modules.find(module => module.name === packageName);
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
          headers.authorization = `Bearer ${ token }`;
        }

        if (registry.endsWith("/")) {
          registry = registry.slice(0, -1);
        }

        let response = await request.get(`${ registry }/${ packageName }`, {
          headers,
          resolveWithFullResponse: true,
          gzip: true
        });

        let parsedContentType = contentType.parse(response.headers["content-type"]);
        if (parsedContentType.type === "application/vnd.npm.install-v1+json" || parsedContentType.type === "application/json") {
          let json = JSON.parse(response.body);
          for (let version of Object.keys(json.versions || {})) {
            let versionObject = json.versions[version];
            if (versionObject.dist && versionObject.dist.tarball) {
              versionObject.dist.tarball = `${ this.myServerAddress }/tarballs/${ encodeURIComponent(packageName) }?url=${ encodeURIComponent(versionObject.dist.tarball) }&norman=remote`;
            }
          }

          let responseHeaders = { ...response.headers };
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
          console.log(`error while fetching package info ${ packageName }: ${ error }`);
        }
      }
    }
  }


  protected getRegistryForPackage(packageName: string): string {
    const npmrc = getNpmRc();

    let org = packageName.startsWith("@") ? packageName.slice(0, packageName.indexOf("/")) : "";
    let result = org ? npmrc.getCustomRegistry(org) || npmrc.defaultRegistry : npmrc.defaultRegistry;
    if (!result) {
      throw new Error(`Npm registry for package ${ packageName } not found`);
    }
    return result;
  }


  protected getTokenForUrl(registryUrl: string): string | null {
    let parsedUrl = url.parse(registryUrl);
    if (parsedUrl.host) {
      return getNpmRc().getTokenForHost(parsedUrl.host) || null;
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
      directories: {},
      _hasShrinkwrap: false,
      dist: {
        tarball: `${ this.myServerAddress }/tarballs/${ module.name }?norman=local&name=${ encodeURIComponent(module.name) }`
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
    const config = getConfig();

    let localModule = config.modules.find(module => module.name === packageName);
    if (localModule) {
      try {
        let packager = new ModulePackager(localModule);
        res.sendFile(await packager.getActualTarballPath());
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
          headers.authorization = `Bearer ${ token }`;
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
          console.log(`error while proxying URL ${ req.query.url }: ${ error }`);
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

    for (let key of getNpmRc().getCustomRegistries()) {
      if (key !== "default") {
        result[`npm_config_${ key }:registry`] = this.myServerAddress;
      }
    }

    result.npm_config_registry = this.myServerAddress;
    result["npm_config_package-lock"] = module.lockfileEnabled ? "true" : "false";

    return result;
  }


  public async installModuleDeps(installTo: ModuleInfo): Promise<void> {
    await utils.cleanNpmCache();

    let npmEnv = this.buildNpmEnv(installTo);

    await utils.runCommand(utils.getNpmExecutable(), [ "install" ], {
      cwd: installTo.path,
      env: npmEnv
    });

    if (installTo.lockfileEnabled) {
      const lockfile = new Lockfile(path.join(installTo.path, "package-lock.json"));
      lockfile.update();
    }

    await utils.runCommand(utils.getNpmExecutable(), [ "prune" ], {
      cwd: installTo.path,
      env: npmEnv
    });

    await utils.cleanNpmCache();
  }


  public async getOutdated(mod: ModuleInfo): Promise<any> {
    let result = await utils.runCommand(utils.getNpmExecutable(), [ "outdated", "--json" ], {
      cwd: mod.path,
      env: this.buildNpmEnv(mod),
      ignoreExitCode: true,
      collectOutput: true,
      silent: true
    });

    result = result ? result.trim() : result;
    if (result) {
      let resultObj = JSON.parse(result);

      for (let dep of Object.keys(resultObj)) {
        let depData = resultObj[dep];
        if (depData.current === "linked") {
          delete resultObj[dep];
        }
      }

      return resultObj;
    }
    return {};
  }


  public async upgradeDependency(mod: ModuleInfo, pkg: string, version: string): Promise<void> {
    await utils.runCommand(utils.getNpmExecutable(), [ "install", `${ pkg }@${ version }` ], {
      cwd: mod.path,
      env: this.buildNpmEnv(mod)
    });
  }


  public static cleanCache(): void {
    fs.removeSync(TARBALL_CACHE_DIR);
  }


  public static async init() {
    const server = new LocalNpmServer();
    await server.start();
    ServiceLocator.instance.initialize("server", server);
  }
}


export function getServer() {
  return ServiceLocator.instance.get<LocalNpmServer>("server");
}
