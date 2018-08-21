import * as express from "express";
import * as request from "request-promise-native";
import * as fs from "fs-extra";
import * as os from "os";
import * as http from "http";
import * as path from "path";
import * as url from "url";
import * as ini from "ini";
import {Norman} from "./norman";
import {ModuleInfo} from "./config";
import * as utils from "./utils";
import chalk from "chalk";
import * as contentType from "content-type";

const accept = require("accept");


const NPM_SERVER_PORT = 5001;
const NPMRC_BACKUP_FILENAME = ".npmrc-norman-backup";
const LOCKFILE_BACKUP_FILENAME = "package-lock.norman-backup.json";


const IGNORED_DIRS = [ "node_modules", ".git", ".idea" ];


export type NpmConfig = {
  registries: { [prefix: string]: string },
  tokens: { [domain: string]: string },
  other: { [key: string]: any };
};


export interface ModuleInfoWithDeps {
  module: ModuleInfo;
  dependencies: ModuleInfo[];
}


export class LocalNpmServer {
  protected app: express.Application;
  protected npmConfig!: NpmConfig;
  protected myServerAddress: string;
  protected port: number;
  protected server: http.Server|null = null;


  constructor(protected norman: Norman, port: number = NPM_SERVER_PORT) {
    this.port = port;
    this.myServerAddress = `http://localhost:${port}`;

    this.app = express();

    this.app.get("/tarballs/:package", (req, res) => {
      this.onGetTarball(req.params.package, req, res);
    });

    this.app.get("/tarballs/:org/:package", (req, res) => {
      this.onGetTarball(`${req.params.org}/${req.params.package}`, req, res);
    });

    this.app.get("/:package", (req, res) => {
      this.onGetPackage(req.params.package, req, res);
    });

    this.app.get("/:org/:package", (req, res) => {
      this.onGetPackage(`${req.params.org}/${req.params.package}`, req, res);
    });
  }


  get config() {
    return this.norman.config;
  }


  async start(): Promise<void> {
    this.npmConfig = this.loadNpmConfig(this.config.mainConfigDir, ".npmrc");

    this.server = this.app.listen(NPM_SERVER_PORT);

    console.log(`Local npm server listening on ${NPM_SERVER_PORT}`);
  }


  async stop(): Promise<void> {
    return new Promise<void>(resolve => {
      if (this.server) {
        this.server.close(() => {
          resolve();
        });
      }
    });
  }


  protected async onGetPackage(packageName: string, req: express.Request, res: express.Response): Promise<void> {
    let localModule = this.config.modules.find(module => module.npmName.name === packageName);
    if (localModule) {
      let acceptedTypes: string[] = accept.mediaTypes(req.headers["accept"]);
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
          headers["authorization"] = `Bearer ${token}`;
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
          delete responseHeaders['content-encoding'];
          delete responseHeaders['transfer-encoding'];

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
    let result = org ? this.npmConfig.registries[org] || this.npmConfig.registries["default"] : this.npmConfig.registries["default"];
    if (!result) {
      throw new Error(`Npm registry for package ${packageName} not found`);
    }
    return result;
  }


  protected getTokenForUrl(registryUrl: string): string|null {
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
      name: module.npmName.name,
      version: moduleVersion,
      directories: { },
      _hasShrinkwrap: false,
      dist: {
        tarball: `${this.myServerAddress}/tarballs/${module.npmName.name}`
      }
    };

    for (let key of [ "dependencies", "devDependencies", "optionalDependencies", "bundleDependencies", "peerDependencies", "bin", "engines" ]) {
      if (moduleMeta[key]) {
        versionObject[key] = moduleMeta[key];
      }
    }

    return {
      name: module.npmName.name,
      modified: new Date().toString(),
      "dist-tags": {
        latest: moduleVersion
      },
      versions: {
        [moduleVersion]: versionObject
      }
    }
  }


  protected async onGetTarball(packageName: string, req: express.Request, res: express.Response): Promise<void> {
    let localModule = this.config.modules.find(module => module.npmName.name === packageName);
    if (localModule) {
      try {
        let archivePath = await this.packModule(localModule);
        // console.log(`packaged package ${packageName} to archive ${archivePath}`);
        res.sendFile(archivePath);
      } catch (error) {
        console.log(error);
      }
    } else {
      try {
        let headers = Object.assign({}, req.headers, { host: url.parse(req.query.url).host });

        let token = this.getTokenForUrl(req.query.url);
        if (token) {
          headers["authorization"] = `Bearer ${token}`;
        }

        let response = await request.get(req.query.url, {
          headers,
          resolveWithFullResponse: true,
          encoding: null
        });

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


  protected isIgnored(module: ModuleInfo, filepath: string): boolean {
    return filepath.endsWith(".tgz");
  }


  protected async packModule(module: ModuleInfo): Promise<string> {
    let tempDirParent = "/tmp/norman";
    if (!fs.existsSync(tempDirParent)) {
      fs.mkdirpSync(tempDirParent);
    }

    let tempDir = path.join(tempDirParent, utils.randomString());

    const copyDir = (sourceDir: string) => {
      let filenames = fs.readdirSync(sourceDir);

      for (let filename of filenames) {
        let filepath = path.join(sourceDir, filename);
        let relativePath = path.relative(module.path, filepath);

        if (this.isIgnored(module, filepath) || IGNORED_DIRS.indexOf(filename) >= 0) {
          continue;
        }

        let parentDestDir = path.dirname(path.join(tempDir, relativePath));
        if (!fs.existsSync(parentDestDir)) {
          fs.mkdirpSync(parentDestDir);
        }

        if (fs.statSync(filepath).isDirectory()) {
          copyDir(filepath);
        } else {
          let destFilePath = path.join(tempDir, relativePath);

          fs.copyFileSync(filepath, destFilePath);
        }
      }
    };

    copyDir(module.path);

    // set npmignore
    if (typeof module.npmIgnore === "string") {
      let ignorePath = module.npmIgnore;
      if (!path.isAbsolute(ignorePath)) {
        ignorePath = path.resolve(this.config.mainConfigDir, ignorePath);
      }

      try {
        fs.copyFileSync(ignorePath, path.join(tempDir, ".npmignore"));
      } catch (error) {
        console.log(`Cannot read ignore file for npm publishing: ${ignorePath}, ${error.message}`);
      }
    }

    await utils.runCommand("npm", [ "pack" ], {
      cwd: tempDir,
      silent: true
    });

    let moduleVersion = fs.readJSONSync(path.join(tempDir, "package.json")).version;

    let archiveName: string;
    if (module.npmName.org) {
      archiveName = `${module.npmName.org}-${module.npmName.pkg}-${moduleVersion}.tgz`;
    } else {
      archiveName = `${module.npmName.pkg}-${moduleVersion}.tgz`;
    }

    return path.join(tempDir, archiveName);
  }


  enterLocalInstall(module: ModuleInfo): void {
    let newConfig: any = {
      registry: this.myServerAddress
    };
    for (let key of Object.keys(this.npmConfig.registries)) {
      if (key !== "default") {
        newConfig[`${key}:registry`] = this.myServerAddress;
      }
    }

    for (let key of Object.keys(this.npmConfig.other)) {
      newConfig[key] = this.npmConfig.other[key];
    }

    newConfig["package-lock"] = false;

    let npmrcFilename = path.join(module.path, ".npmrc");
    let backupFilename = path.join(module.path, NPMRC_BACKUP_FILENAME);
    if (fs.existsSync(npmrcFilename)) {
      fs.copyFileSync(npmrcFilename, backupFilename);
    }

    fs.writeFileSync(path.join(module.path, ".npmrc"), ini.stringify(newConfig), { encoding: "utf-8" });

    let lockFilename = path.join(module.path, "package-lock.json"),
        lockBackupFilename = path.join(module.path, LOCKFILE_BACKUP_FILENAME);
    try {
      fs.copyFileSync(lockFilename, lockBackupFilename);
      fs.unlinkSync(lockFilename);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }


  exitLocalInstall(module: ModuleInfo): void {
    let backupFilename = path.join(module.path, NPMRC_BACKUP_FILENAME);
    let npmrcFilename = path.join(module.path, ".npmrc");

    try {
      if (!fs.existsSync(backupFilename)) {
        fs.removeSync(npmrcFilename);
      } else {
        fs.copyFileSync(backupFilename, npmrcFilename);
        fs.removeSync(backupFilename);
      }
      console.log(`.npmrc for project ${module.npmName.name} is restored`);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    let lockFilename = path.join(module.path, "package-lock.json"),
        lockBackupFilename = path.join(module.path, LOCKFILE_BACKUP_FILENAME);

    try {
      fs.copyFileSync(lockBackupFilename, lockFilename);
      fs.unlinkSync(lockBackupFilename);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }


  protected loadNpmConfig(dir: string, projectConfigFileName: string): NpmConfig {
    const loadNpmrc = (filename: string): NpmConfig => {
      let npmrcText: string = "";
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
          npmConfig.registries["default"] = parsedConfig[key];
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


  getDependencyTree(modules: ModuleInfo[]): ModuleInfoWithDeps[] {
    return modules.map(module => {
      let subDeps = utils.getPackageDeps(module.path).map(moduleName => this.norman.getModuleInfo(moduleName)).filter(dep => dep != null);

      return {
        module,
        dependencies: subDeps as ModuleInfo[]
      }
    });
  }


  async walkDependencyTree(modules: ModuleInfo[], walker: (module: ModuleInfo) => Promise<void>): Promise<void> {
    let tree = this.getDependencyTree(modules);

    const walkedModules: string[] = [];

    const markWalked = (module: ModuleInfo) => {
      if (walkedModules.indexOf(module.npmName.name) < 0) {
        walkedModules.push(module.npmName.name);
      }
    };

    const isAlreadyWalked = (module: ModuleInfo) => {
      return walkedModules.indexOf(module.npmName.name) >= 0;
    };

    const walkModule = async (module: ModuleInfoWithDeps, parents: string[]) => {
      if (isAlreadyWalked(module.module)) {
        return;
      }

      for (let dep of module.dependencies) {
        if (parents.indexOf(dep.npmName.name) >= 0) {
          // recursive dep
          throw new Error(`Recursive dependency: ${dep.npmName.name}, required by ${parents.join(" -> ")}`);
        }

        let depWithDeps = tree.find(module => module.module.npmName.name === dep.npmName.name);
        if (depWithDeps) {
          await walkModule(depWithDeps, parents.concat([ module.module.npmName.name ]));
        }
      }

      await walker(module.module);

      markWalked(module.module);
    };

    for (let module of tree) {
      await walkModule(module, []);
    }
  }


  async installLocalModule(installTo: ModuleInfo, moduleToInstall: ModuleInfo): Promise<void> {
    await utils.cleanNpmCache();

    this.enterLocalInstall(installTo);

    try {
      await utils.runCommand("npm", [ "install", moduleToInstall.npmName.name ], {
        cwd: installTo.path
      });
    } finally {
      this.exitLocalInstall(installTo);
    }

    await utils.cleanNpmCache();
  }


  async installModuleDeps(installTo: ModuleInfo): Promise<void> {
    await utils.cleanNpmCache();

    this.enterLocalInstall(installTo);

    try {
      await utils.runCommand("npm", [ "install" ], {
        cwd: installTo.path
      })
    } finally {
      this.exitLocalInstall(installTo);
    }

    await utils.cleanNpmCache();
  }
}
