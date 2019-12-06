import {ModuleInfo} from "./module-info";
import * as path from "path";
import * as fs from "fs-extra";
import {ModuleInfoWithDeps} from "./server";
import * as utils from "./utils";
import {Norman} from "./norman";
import chalk from "chalk";


const CONFIG_FILE_NAME = ".norman.json";


interface RawConfig {
  modules?: any;
  modulesDirectory?: any;
  defaultNpmIgnore?: any;
  defaultIgnoreOrg?: any;
  includeModules?: any;
  defaultBranch?: any;
  defaultNpmInstall?: any;
  defaultBuildTriggers: any;
}


interface ConfigInit {
  mainConfigDir: string;
  mainModulesDir: string;
  defaultIgnoreOrg: boolean;
  defaultNpmIgnorePath: string | boolean;
  defaultBranch: string;
  defaultNpmInstall: boolean;
  defaultBuildTriggers: string[];
}


export class Config {
  private _mainConfigDir: string;
  private _mainModulesDir: string;
  private _defaultIgnoreOrg: boolean;
  private _defaultNpmIgnoreHint: string | boolean;
  private _modules: ModuleInfo[] = [];
  private _defaultBranch: string;
  private _defaultNpmInstall: boolean;
  private _defaultBuildTriggers: string[];


  public get mainConfigDir(): string { return this._mainConfigDir; }

  public get mainModulesDir(): string { return this._mainModulesDir; }

  public get defaultBranch(): string { return this._defaultBranch; }

  public get defaultIgnoreOrg(): boolean { return this._defaultIgnoreOrg; }

  public get defaultNpmIgnoreHint(): string | boolean { return this._defaultNpmIgnoreHint; }

  public get defaultNpmInstall(): boolean { return this._defaultNpmInstall; }

  public get defaultBuildTriggers(): string[] { return this._defaultBuildTriggers; }

  public get modules(): ModuleInfo[] { return this._modules; }


  public constructor(init: ConfigInit) {
    this._mainConfigDir = init.mainConfigDir;
    this._mainModulesDir = init.mainModulesDir;
    this._defaultIgnoreOrg = init.defaultIgnoreOrg;
    this._defaultNpmIgnoreHint = init.defaultNpmIgnorePath;
    this._defaultBranch = init.defaultBranch;
    this._defaultNpmInstall = init.defaultNpmInstall;
    this._defaultBuildTriggers = init.defaultBuildTriggers;
  }


  public getModuleInfo(moduleName: string): ModuleInfo | null {
    return this._modules.find(module => module.name === moduleName) || null;
  }


  public getDependencyTree(modules: ModuleInfo[]): ModuleInfoWithDeps[] {
    return modules.map(module => {
      let subDeps = utils.getPackageDeps(module.path).map(moduleName => this.getModuleInfo(moduleName)).filter(dep => dep != null);

      return {
        module,
        dependencies: subDeps as ModuleInfo[]
      };
    });
  }


  public async walkDependencyTree(modules: ModuleInfo[], walker: (module: ModuleInfo) => Promise<void>): Promise<void> {
    let tree = this.getDependencyTree(modules);

    const walkedModules: string[] = [];

    const markWalked = (module: ModuleInfo) => {
      if (walkedModules.indexOf(module.name) < 0) {
        walkedModules.push(module.name);
      }
    };

    const isAlreadyWalked = (module: ModuleInfo) => {
      return walkedModules.indexOf(module.name) >= 0;
    };

    const walkModule = async(module: ModuleInfoWithDeps, parents: string[]) => {
      if (isAlreadyWalked(module.module)) {
        return;
      }

      for (let dep of module.dependencies) {
        if (parents.indexOf(dep.name) >= 0) {
          // recursive dep
          throw new Error(`Recursive dependency: ${dep.name}, required by ${parents.join(" -> ")}`);
        }

        let depWithDeps = tree.find(mod => mod.module.name === dep.name);
        if (depWithDeps) {
          await walkModule(depWithDeps, parents.concat([ module.module.name ]));
        }
      }

      await walker(module.module);

      markWalked(module.module);
    };

    for (let module of tree) {
      await walkModule(module, []);
    }
  }


  public static loadConfig(configFilename: string, rawConfig: RawConfig, isMainConfig: boolean, ignoreMissing: boolean, norman: Norman): Config {
    let mainConfigDir = path.dirname(configFilename);

    let mainModulesDir: string;
    if ("modulesDirectory" in rawConfig) {
      if (typeof rawConfig.modulesDirectory !== "string") {
        throw new Error("`modulesDirectory' should be a string");
      }
      if (!path.isAbsolute(rawConfig.modulesDirectory)) {
        mainModulesDir = path.resolve(mainConfigDir, rawConfig.modulesDirectory);
      } else {
        mainModulesDir = rawConfig.modulesDirectory;
      }
    } else {
      mainModulesDir = mainConfigDir;
    }

    let defaultIgnoreOrg = false;
    if ("defaultIgnoreOrg" in rawConfig) {
      if (typeof rawConfig.defaultIgnoreOrg !== "boolean") {
        throw new Error("'defaultIgnoreOrg' should be a boolean");
      }
      defaultIgnoreOrg = rawConfig.defaultIgnoreOrg;
    }

    let defaultNpmIgnorePath: string | boolean = true;
    if ("defaultNpmIgnore" in rawConfig) {
      if (typeof rawConfig.defaultNpmIgnore !== "string" && typeof rawConfig.defaultNpmIgnore !== "boolean") {
        throw new Error("'defaultNpmIgnoreHint' should be a string or a boolean");
      }
      defaultNpmIgnorePath = rawConfig.defaultNpmIgnore;
    }

    let defaultBranch = "master";
    if ("defaultBranch" in rawConfig) {
      if (typeof rawConfig.defaultBranch !== "string") {
        throw new Error("'defaultBranch' should be a string");
      }
      defaultBranch = rawConfig.defaultBranch;
    }

    let defaultNpmInstall = true;
    if ("defaultNpmInstall" in rawConfig) {
      if (typeof rawConfig.defaultNpmInstall !== "boolean") {
        throw new Error("'defaultNpmInstall' should be a string");
      }
      defaultNpmInstall = rawConfig.defaultNpmInstall;
    }

    let defaultBuildDeps: string[] = [];
    if ("defaultBuildTriggers" in rawConfig) {
      if (!Array.isArray(rawConfig.defaultBuildTriggers)) {
        throw new Error("'defaultBuildTriggers' should be an array of strings");
      }
      defaultBuildDeps = rawConfig.defaultBuildTriggers;
    }

    let appConfig = new Config({ mainConfigDir, mainModulesDir, defaultIgnoreOrg, defaultNpmIgnorePath, defaultBranch, defaultNpmInstall, defaultBuildTriggers: defaultBuildDeps });

    appConfig._modules = this.loadModules(configFilename, rawConfig, appConfig, isMainConfig, ignoreMissing, norman);

    return appConfig;
  }


  private static loadModules(configFilename: string, rawConfig: RawConfig, appConfig: Config, isMainConfig: boolean, ignoreMissing: boolean, norman: Norman): ModuleInfo[] {
    let configDir = path.dirname(configFilename);

    let modules: ModuleInfo[] = [];
    if ("includeModules" in rawConfig) {
      if (!Array.isArray(rawConfig.includeModules)) {
        throw new Error("'includeModules' should be an array");
      }
      for (let configPath of rawConfig.includeModules) {
        if (typeof configPath !== "string") {
          throw new Error("'includeModules' should be an array of strings");
        }

        if (!path.isAbsolute(configPath)) {
          configPath = path.resolve(configDir, configPath);
        }

        let configPathStat: fs.Stats;
        try {
          configPathStat = fs.statSync(configPath);
        } catch (error) {
          if (ignoreMissing) {
            console.log(chalk.yellow(`Ignoring "includeModules" for "${configPath}", configuration file does not exist`));
            continue;
          }

          throw new Error(`Failed to include config at ${configPath}: ${error.message}`);
        }

        if (configPathStat.isDirectory()) {
          configPath = path.join(configPath, CONFIG_FILE_NAME);
        }

        try {
          let config = Config.loadConfigFromFile(configPath, false, ignoreMissing, norman);

          let extraModules = config._modules.filter(extraModule => !modules.find(module => module.name === extraModule.name));

          modules = modules.concat(extraModules);
        } catch (error) {
          throw new Error(`Failed to include modules from config at "${configPath}" (while parsing config at "${configFilename}": ${error.message}`);
        }
      }
    }

    if ("modules" in rawConfig) {
      if (!Array.isArray(rawConfig.modules)) {
        throw new Error("'modules' should be an array");
      }

      for (let rawModule of rawConfig.modules) {
        if (!rawModule || typeof rawModule !== "object") {
          throw new Error("'modules' should be an array of objects");
        }

        modules.push(ModuleInfo.createFromConfig(rawModule, appConfig, isMainConfig, configDir, norman));
      }
    }

    return modules;
  }


  public static findAndLoadConfig(startDir: string, ignoreMissing: boolean, norman: Norman): Config {
    const findConfigForDir = (dir: string): string => {
      if (!dir || dir === "/" || dir === ".") {
        throw new Error(`No ${CONFIG_FILE_NAME} found in directory tree`);
      }

      let configLocation = path.join(dir, CONFIG_FILE_NAME);
      if (fs.existsSync(configLocation)) {
        return configLocation;
      } else {
        return findConfigForDir(path.dirname(dir));
      }
    };

    return this.loadConfigFromFile(findConfigForDir(startDir), true, ignoreMissing, norman);
  }


  public static loadConfigFromFile(filename: string, isMainConfig: boolean, ignoreMissing: boolean, norman: Norman): Config {
    let rawConfig = fs.readFileSync(filename, {
      encoding: "utf-8"
    });

    try {
      return this.loadConfig(filename, JSON.parse(rawConfig), isMainConfig, ignoreMissing, norman);
    } catch (error) {
      // invalid config, stop here
      throw new Error(`Invalid config file ${filename}: ${error.message}`);
    }
  }
}
