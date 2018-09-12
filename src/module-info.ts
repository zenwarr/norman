import {Config} from "./config";
import * as path from "path";
import * as fs from "fs-extra";
import gitUrlParse = require("git-url-parse");
import * as utils from "./utils";
import {BUILD_TAG, ModuleStateManager} from "./module-state-manager";
import {Norman} from "./norman";
import ignore from "ignore";
import {ModulePackager} from "./module-packager";
import {Base} from "./base";


interface RawModuleConfig {
  branch: any;
  name: any;
  npmName: any;
  ignoreOrg: any;
  npmIgnore: any;
  path: any;
  repository: any;
  buildCommands: any;
  npmInstall: any;
}

export interface ModuleNpmName {
  org: string;
  pkg: string;
  name: string;
}

export interface ModuleInfoInit {
  repository: string | null;
  npmName: ModuleNpmName;
  buildCommands: string[];
  branch: string;
  path: string;
  ignoreOrg: boolean;
  npmIgnorePath: string | null;
  npmInstall: boolean;
  appConfig: Config;
}

export const IGNORE_REGEXPS = [
  /node_modules$/,
  /.git$/,
  /.idea$/,
  /\/.npmrc-norman-backup$/,
  /\/package-lock.norman-backup.json$/
];

export class ModuleInfo extends Base {
  private _repository: string | null;
  private _npmName: ModuleNpmName;
  private _buildCommands: string[];
  private _branch: string;
  private _path: string;
  private _npmIgnorePath: string | null;
  private _appConfig: Config;
  private _npmInstall: boolean;


  public get name(): string { return this._npmName.name; }

  public get npmName(): ModuleNpmName { return this._npmName; }

  public get path(): string { return this._path; }

  public get needsNpmInstall(): boolean { return this._npmInstall; }


  private constructor(init: ModuleInfoInit, norman: Norman) {
    super(norman);
    this._path = init.path;
    this._repository = init.repository;
    this._buildCommands = init.buildCommands;
    this._branch = init.branch;
    this._npmIgnorePath = init.npmIgnorePath;
    this._npmName = init.npmName;
    this._appConfig = init.appConfig;
    this._npmInstall = init.npmInstall;
  }


  public static createFromConfig(rawConfig: RawModuleConfig, appConfig: Config, norman: Norman): ModuleInfo {
    if (typeof rawConfig.repository !== "string") {
      throw new Error("required 'repository' field should be a string");
    }
    let repository = rawConfig.repository;

    let npmName = npmNameFromPackageName(gitUrlParse(repository).full_name);

    let branch = appConfig.defaultBranch;
    if ("branch" in rawConfig) {
      if (typeof rawConfig.branch !== "string") {
        throw new Error("'branch' should be a string");
      }
      branch = rawConfig.branch;
    }

    let ignoreOrg = appConfig.defaultIgnoreOrg;
    if ("ignoreOrg" in rawConfig) {
      if (typeof rawConfig.ignoreOrg !== "boolean") {
        throw new Error("'ignoreOrg' should be a boolean");
      }
      ignoreOrg = rawConfig.ignoreOrg;
    }

    let modulePath: string;
    if ("path" in rawConfig) {
      if (typeof rawConfig.path !== "string") {
        throw new Error("'path' should be a string");
      }
      modulePath = rawConfig.path;
      if (!path.isAbsolute(modulePath)) {
        throw new Error(`Path for module ${npmName.name} should be absolute`);
      }
    } else {
      modulePath = path.join(appConfig.mainModulesDir, ignoreOrg ? npmName.pkg : npmName.name);
    }

    let npmIgnoreHint = appConfig.defaultNpmIgnoreHint;
    if ("npmIgnore" in rawConfig) {
      if (typeof rawConfig.npmIgnore !== "string" && typeof rawConfig.npmIgnore !== "boolean") {
        throw new Error("'npmIgnore' should be a string or a boolean");
      }
      npmIgnoreHint = rawConfig.npmIgnore;
    }

    let npmIgnorePath = this.resolveIgnoreFromHint(npmIgnoreHint, modulePath, appConfig);

    let buildCommands: string[] = [];
    if ("buildCommands" in rawConfig) {
      if (!Array.isArray(rawConfig.buildCommands)) {
        throw new Error("'buildCommands' should be an array");
      }
      buildCommands = rawConfig.buildCommands.map(cmd => {
        if (typeof cmd !== "string") {
          throw new Error("'buildCommands' should be an array of string");
        }
        return cmd;
      });
    }

    let npmInstall = appConfig.defaultNpmInstall;
    if ("npmInstall" in rawConfig) {
      if (typeof rawConfig.npmInstall !== "boolean") {
        throw new Error("'npmInstall' should be a boolean");
      }
      npmInstall = rawConfig.npmInstall;
    }

    return new ModuleInfo({
      repository,
      npmName,
      buildCommands,
      branch,
      path: modulePath,
      ignoreOrg,
      npmIgnorePath,
      appConfig,
      npmInstall
    }, norman);
  }


  public static createImplicit(dir: string, appConfig: Config, norman: Norman): ModuleInfo | null {
    let packageJsonPath = path.join(dir, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      return null;
    }

    let pkg = fs.readJSONSync(packageJsonPath);

    let pkgName = pkg.name;
    let npmName: ModuleNpmName;
    if (pkgName.indexOf("/") >= 0) {
      npmName = {
        org: pkgName.slice(0, pkgName.indexOf("/")),
        pkg: pkgName.slice(pkgName.indexOf("/") + 1),
        name: pkgName
      };
    } else {
      npmName = {
        org: "",
        pkg: pkgName,
        name: pkgName
      };
    }

    return new ModuleInfo({
      repository: null,
      buildCommands: [],
      branch: appConfig.defaultBranch,
      path: appConfig.mainConfigDir,
      ignoreOrg: appConfig.defaultIgnoreOrg,
      npmIgnorePath: this.resolveIgnoreFromHint(appConfig.defaultNpmIgnoreHint, dir, appConfig),
      npmName,
      appConfig,
      npmInstall: true
    }, norman);
  }


  public static resolveIgnoreFromHint(hint: string | boolean, modulePath: string, appConfig: Config): string | null {
    let npmIgnorePath: string | null = null;
    if (typeof hint === "string") {
      if (!path.isAbsolute(hint)) {
        npmIgnorePath = path.resolve(appConfig.mainConfigDir, hint);
      } else {
        npmIgnorePath = hint;
      }
    } else if (hint) {
      npmIgnorePath = path.join(modulePath, ".npmignore");
      if (!fs.existsSync(npmIgnorePath) && typeof appConfig.defaultNpmIgnoreHint === "string") {
        return this.resolveIgnoreFromHint(appConfig.defaultNpmIgnoreHint, modulePath, appConfig);
      } else {
        return null;
      }
    }

    return npmIgnorePath;
  }


  public async fetch(): Promise<void> {
    if (!this._repository || fs.existsSync(this.path)) {
      return;
    }

    await utils.runCommand("git", [ "clone", this._repository, "-b", this._branch, this.path ]);
  }


  public createStateManager(): ModuleStateManager {
    return new ModuleStateManager(this.norman, this);
  }


  public createPackager(): ModulePackager { return new ModulePackager(this.norman, this); }


  public async install(): Promise<void> {
    if (fs.existsSync(path.join(this.path, "node_modules")) || !this._npmInstall) {
      return;
    }

    await this.norman.localNpmServer.installModuleDeps(this);

    await this.buildModuleIfChanged();
  }


  public async buildModuleIfChanged(): Promise<boolean> {
    let stateManager = this.createStateManager();
    if (await stateManager.isModuleChanged(BUILD_TAG)) {
      await this.buildModule();
      await stateManager.saveActualState(BUILD_TAG);
      return true;
    }
    return false;
  }


  protected async buildModule(): Promise<void> {
    for (let buildCommand of this._buildCommands) {
      await utils.runCommand("npm", [ "run", buildCommand ], {
        cwd: this._path
      });
    }
  }


  public isDependsOn(module: ModuleInfo): boolean {
    return fs.existsSync(path.join(this.path, "node_modules", module.name));
  }


  public isFileShouldBePublished(filepath: string): boolean {
    return !this.isIgnoredByRules(filepath) && this.isModuleFile(filepath);
  }


  public isIgnoredByRules(filepath: string): boolean {
    if (path.isAbsolute(filepath)) {
      filepath = path.relative(this.path, filepath);
      if (!filepath) {
        return false;
      }
    }

    let ignoreInstance = this.ignoreInstance;
    if (ignoreInstance) {
      return ignoreInstance.ignores(filepath);
    }

    return false;
  }


  public isModuleFile(filepath: string): boolean {
    for (let ignoreRe of IGNORE_REGEXPS) {
      if (filepath.match(ignoreRe)) {
        return false;
      }
    }
    return true;
  }


  protected get ignoreInstance(): any {
    if (this._npmIgnorePath) {
      let ignoreInstance = ignore();
      ignoreInstance.add(fs.readFileSync(this._npmIgnorePath, "utf-8"));
      return ignoreInstance;
    } else {
      return null;
    }
  }


  public async walkModuleFiles(walker: (filename: string, state: fs.Stats) => Promise<void>): Promise<void> {
    const handle = async(source: string) => {
      if (!this.isModuleFile(source)) {
        return;
      }

      let sourceStat: fs.Stats;
      try {
        sourceStat = fs.statSync(source);
      } catch (error) {
        // we can still get exception here, for example, with broken links, just ignore it
        return;
      }

      if (source !== this.path) {
        await walker(source, sourceStat);
      }

      if (sourceStat.isDirectory()) {
        for (let filename of fs.readdirSync(source)) {
          await handle(path.join(source, filename));
        }
      }
    };

    return handle(this.path);
  }


  public getDirectLocalDependencies(includeDev: boolean): ModuleInfo[] {
    let dependentPackages = utils.getPackageDeps(this.path, false);
    return dependentPackages.map(pkg => this.config.getModuleInfo(pkg)).filter(dep => !!dep) as ModuleInfo[];
  }


  public getLocalDependencies(includeDev: boolean): ModuleInfo[] {
    let result: ModuleInfo[] = [];

    const handleModule = (module: ModuleInfo) => {
      let deps = module.getDirectLocalDependencies(includeDev);

      for (let dep of deps) {
        if (!result.find(mod => mod.name === dep.name)) {
          result.push(dep);
          handleModule(dep);
        }
      }
    };

    handleModule(this);

    return result;
  }
}


function npmNameFromPackageName(name: string): ModuleNpmName {
  if (name.indexOf("/") > 0) {
    let [ org, pkg ] = name.split("/");
    return { org, pkg, name: `@${org}/${pkg}` };
  } else {
    return { org: "", pkg: name, name };
  }
}
