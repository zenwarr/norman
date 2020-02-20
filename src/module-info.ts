import { Config, getConfig } from "./config";
import * as path from "path";
import * as fs from "fs-extra";
import gitUrlParse = require("git-url-parse");
import * as utils from "./utils";
import ignore from "ignore";
import { getPluginManager } from "./plugins";
import { Lockfile } from "./lockfile";
import { BuildDependenciesSubset } from "./build-dependencies-subset";
import { getStateManager } from "./module-state-manager";
import { NpmRunner } from "./module-npm-runner";


interface RawModuleConfig {
  branch?: unknown;
  name?: unknown;
  npmName?: unknown;
  ignoreOrg?: unknown;
  npmIgnore?: unknown;
  path?: unknown;
  repository?: unknown;
  buildCommands?: unknown;
  npmInstall?: unknown;
  buildTriggers?: unknown;
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
  isMain: boolean;
  buildTriggers: string[];
}

export const IGNORE_REGEXPS = [
  /node_modules$/,
  /.git$/,
  /.idea$/
];

export class ModuleInfo {
  public get name(): string {
    return this._config.npmName.name;
  }

  public get npmName(): ModuleNpmName {
    return this._config.npmName;
  }

  public get path(): string {
    return this._config.path;
  }

  public get managedByNPM(): boolean {
    return this._config.npmInstall;
  }

  public get isMain(): boolean {
    return this._config.isMain;
  }

  public get buildTriggers(): string[] {
    return this._config.buildTriggers;
  }

  public hasLockFile(): boolean {
    return Lockfile.existsInDir(this.path);
  }


  public constructor(private _config: ModuleInfoInit) {

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
    if (!this._config.repository || fs.existsSync(this.path)) {
      return;
    }

    await utils.runCommand("git", [ "clone", this._config.repository, "-b", this._config.branch, this.path ]);
  }


  public async installIfDepsNotInitialized(): Promise<void> {
    if (!this.managedByNPM || fs.existsSync(path.join(this.path, "node_modules"))) {
      return;
    }

    await NpmRunner.install(this);

    await this.buildIfChanged();
  }


  public async buildIfChanged(): Promise<boolean> {
    const buildSubset = new BuildDependenciesSubset();
    const stateManager = getStateManager();

    if (await stateManager.isSubsetChanged(this, buildSubset)) {
      await this.buildModule();

      stateManager.saveState(this, await stateManager.getActualState(this));

      return true;
    }

    return false;
  }


  protected async buildModule(): Promise<void> {
    for (let buildCommand of this._config.buildCommands) {
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
    if (this._config.npmIgnorePath) {
      let ignoreInstance = ignore();
      ignoreInstance.add(fs.readFileSync(this._config.npmIgnorePath, "utf-8"));
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

    let dependentPackages = utils.getDirectDeps(this.path, includeDev);
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
