import { Config, getConfig } from "./config";
import * as path from "path";
import * as fs from "fs-extra";
import gitUrlParse = require("git-url-parse");
import * as utils from "./utils";
import { BUILD_TAG, ModuleStateManager } from "./module-state-manager";
import ignore from "ignore";
import { ModulePackager } from "./module-packager";
import { getServer } from "./server";
import { getPluginManager } from "./plugins";


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
  buildTriggers: any;
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
  isMain: boolean;
  buildTriggers: string[];
}

export const IGNORE_REGEXPS = [
  /node_modules$/,
  /.git$/,
  /.idea$/
];

export class ModuleInfo {
  private _repository: string | null;
  private _npmName: ModuleNpmName;
  private _buildCommands: string[];
  private _branch: string;
  private _path: string;
  private _npmIgnorePath: string | null;
  private _appConfig: Config;
  private _npmInstall: boolean;
  private _isMain: boolean;
  private _buildTriggers: string[];


  public get name(): string {
    return this._npmName.name;
  }

  public get npmName(): ModuleNpmName {
    return this._npmName;
  }

  public get path(): string {
    return this._path;
  }

  public get needsNpmInstall(): boolean {
    return this._npmInstall;
  }

  public get isMain(): boolean {
    return this._isMain;
  }

  public get buildTriggers(): string[] {
    return this._buildTriggers;
  }


  private constructor(init: ModuleInfoInit) {
    this._path = init.path;
    this._repository = init.repository;
    this._buildCommands = init.buildCommands;
    this._branch = init.branch;
    this._npmIgnorePath = init.npmIgnorePath;
    this._npmName = init.npmName;
    this._appConfig = init.appConfig;
    this._npmInstall = init.npmInstall;
    this._isMain = init.isMain;
    this._buildTriggers = init.buildTriggers;
  }


  public static createFromConfig(rawConfig: RawModuleConfig, appConfig: Config, isMain: boolean, configDir: string): ModuleInfo {
    let repository: string | null = null;
    if ("repository" in rawConfig) {
      if (typeof rawConfig.repository !== "string") {
        throw new Error("'repository' should be a string");
      }
      repository = rawConfig.repository;
    }

    let npmName: ModuleNpmName;
    if ("name" in rawConfig) {
      if (typeof rawConfig.name !== "string") {
        throw new Error("'name' should be a string");
      }
      npmName = npmNameFromPackageName(rawConfig.name);
    } else if (repository != null) {
      npmName = npmNameFromPackageName(gitUrlParse(repository).full_name);
    } else {
      throw new Error("module should have either 'repository' or 'name' field present");
    }

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
        modulePath = path.resolve(configDir, modulePath);
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

    let buildTriggers: string[] = appConfig.defaultBuildTriggers;
    if ("buildTriggers" in rawConfig) {
      if (!Array.isArray(rawConfig.buildTriggers)) {
        throw new Error("'buildDeps' should be an array of strings");
      }
      buildTriggers = rawConfig.buildTriggers;
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
      npmInstall,
      isMain,
      buildTriggers
    });
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
    return new ModuleStateManager(this);
  }


  public createPackager(): ModulePackager {
    return new ModulePackager(this);
  }


  public async install(): Promise<void> {
    if (fs.existsSync(path.join(this.path, "node_modules")) || !this.needsNpmInstall) {
      return;
    }

    await getServer().installModuleDeps(this);

    await this.buildModuleIfChanged();
  }


  public async buildModuleIfChanged(): Promise<boolean> {
    let stateManager = this.createStateManager();
    if (await stateManager.needsRebuild(BUILD_TAG)) {
      await this.buildModule();
      await stateManager.saveActualState(BUILD_TAG);
      return true;
    }
    return false;
  }


  protected async buildModule(): Promise<void> {
    for (let buildCommand of this._buildCommands) {
      if (this.hasScript(buildCommand)) {
        await utils.runCommand(utils.getNpmExecutable(), [ "run", buildCommand ], {
          cwd: this.path
        });
      } else {
        await utils.runCommand(buildCommand, null, {
          cwd: this.path
        });
      }
    }
  }


  protected hasScript(scriptName: string): boolean {
    let packageJSON: any;
    try {
      packageJSON = fs.readJsonSync(path.join(this.path, "package.json"));
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      return false;
    }

    return Object.keys(packageJSON.scripts || {}).indexOf(scriptName) >= 0;
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


  private getDirectLocalDependencies(includeDev: boolean): ModuleInfo[] {
    const config = getConfig();

    let dependentPackages = utils.getPackageDeps(this.path, includeDev);
    return dependentPackages.map(pkg => config.getModuleInfo(pkg)).filter(dep => !!dep) as ModuleInfo[];
  }


  /**
   * Return list of dependencies of the current module that are managed locally by norman.
   */
  public getLocalDependencies(includeDev: boolean): ModuleInfo[] {
    let result: ModuleInfo[] = [];

    const handleModule = (module: ModuleInfo, level: number) => {
      let deps = module.getDirectLocalDependencies(includeDev ? level === 0 : false);

      for (let dep of deps) {
        if (!result.find(mod => mod.name === dep.name)) {
          result.push(dep);
          handleModule(dep, level + 1);
        }
      }
    };

    handleModule(this, 0);

    return result;
  }


  public async copyFile(source: string, target: string, isExecutable: boolean = false): Promise<void> {
    // here we always copy a file by loading it into memory because fs.copyFile has problems on VirtualBox shared folders

    const saveFile = () => {
      // tslint:disable-next-line no-bitwise
      fs.writeFileSync(target, fileContent, { mode: (isExecutable ? 0o0100 : 0) | 0o666 });
    };

    let fileContent = fs.readFileSync(source);

    for (let plugin of getPluginManager().plugins) {
      if (plugin.matches(this, source)) {
        fileContent = await plugin.process(this, source, fileContent);
        saveFile();
        return;
      }
    }

    saveFile();
  }
}


function npmNameFromPackageName(name: string): ModuleNpmName {
  if (name.indexOf("/") > 0) {
    let [ org, pkg ] = name.split("/");
    if (org.startsWith("@")) {
      org = org.slice(1);
    }
    return { org, pkg, name: `@${ org }/${ pkg }` };
  } else {
    return { org: "", pkg: name, name };
  }
}
