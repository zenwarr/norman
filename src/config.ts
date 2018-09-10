import {ModuleInfo} from "./module-info";
import * as path from "path";
import chalk from "chalk";
import * as fs from "fs-extra";
import {ModuleInfoWithDeps} from "./server";
import * as utils from "./utils";
import {Norman} from "./norman";


const CONFIG_FILE_NAME = ".norman.json";


interface RawConfig {
  modules?: any;
  modulesDirectory?: any;
  defaultNpmIgnore?: any;
  defaultIgnoreOrg?: any;
  includeModules?: any;
  defaultBranch?: any;
}


interface ConfigInit {
  mainConfigDir: string;
  mainModulesDir: string;
  defaultIgnoreOrg: boolean;
  defaultNpmIgnorePath: string | boolean;
  defaultBranch: string;
}


export class Config {
  private _mainConfigDir: string;
  private _mainModulesDir: string;
  private _defaultIgnoreOrg: boolean;
  private _defaultNpmIgnoreHint: string | boolean;
  private _modules: ModuleInfo[] = [];
  private _defaultBranch: string;


  public get mainConfigDir(): string { return this._mainConfigDir; }

  public get mainModulesDir(): string { return this._mainModulesDir; }

  public get defaultBranch(): string { return this._defaultBranch; }

  public get defaultIgnoreOrg(): boolean { return this._defaultIgnoreOrg; }

  public get defaultNpmIgnoreHint(): string | boolean { return this._defaultNpmIgnoreHint; }

  public get modules(): ModuleInfo[] { return this._modules; }


  public constructor(init: ConfigInit) {
    this._mainConfigDir = init.mainConfigDir;
    this._mainModulesDir = init.mainModulesDir;
    this._defaultIgnoreOrg = init.defaultIgnoreOrg;
    this._defaultNpmIgnoreHint = init.defaultNpmIgnorePath;
    this._defaultBranch = init.defaultBranch;
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


  public static loadConfig(configFilename: string, rawConfig: RawConfig, isMainConfig: boolean, norman: Norman): Config {
    let mainConfigDir = path.dirname(configFilename);

    let mainModulesDir: string;
    if (rawConfig.modulesDirectory == null || typeof rawConfig.modulesDirectory !== "string") {
      throw new Error("'modulesDirectory' should be a string");
    } else {
      if (!path.isAbsolute(rawConfig.modulesDirectory)) {
        mainModulesDir = path.resolve(mainConfigDir, rawConfig.modulesDirectory);
      } else {
        mainModulesDir = rawConfig.modulesDirectory;
      }
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

    let appConfig = new Config({ mainConfigDir, mainModulesDir, defaultIgnoreOrg, defaultNpmIgnorePath, defaultBranch });

    appConfig._modules = this.loadModules(configFilename, rawConfig, appConfig, isMainConfig, norman);

    return appConfig;
  }


  private static loadModules(configFilename: string, rawConfig: RawConfig, appConfig: Config, isMainConfig: boolean, norman: Norman): ModuleInfo[] {
    let mainConfigDir = path.dirname(configFilename);

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
          configPath = path.resolve(mainConfigDir, configPath);
        }

        try {
          let config = Config.loadConfigFromFile(configPath, false, norman);

          let extraModules = config._modules.filter(extraModule => {
            if (modules.find(module => module.name === extraModule.name)) {
              console.log(chalk.yellow(`Ignoring module "${extraModule.name}" because it has been already loaded`));
              return false;
            }
            return true;
          });

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

        modules.push(ModuleInfo.createFromConfig(rawModule, appConfig, norman));
      }
    }

    if (isMainConfig && !this.hasImplicitModule(modules, mainConfigDir)) {
      let implicitModule = ModuleInfo.createImplicit(mainConfigDir, appConfig, norman);
      if (implicitModule) {
        modules.push(implicitModule);
      }
    }

    return modules;
  }


  private static hasImplicitModule(modules: ModuleInfo[], mainConfigDir: string): boolean {
    return modules.find(module => module.name === mainConfigDir) != null;
  }


  public static findAndLoadConfig(startDir: string, norman: Norman): Config {
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

    return this.loadConfigFromFile(findConfigForDir(startDir), true, norman);
  }


  public static loadConfigFromFile(filename: string, isMainConfig: boolean, norman: Norman): Config {
    console.log(`Loading config file from ${filename}`);

    let rawConfig = fs.readFileSync(filename, {
      encoding: "utf-8"
    });

    try {
      return this.loadConfig(filename, JSON.parse(rawConfig), true, norman);
    } catch (error) {
      // invalid config, stop here
      throw new Error(`Invalid config file ${filename}: ${error.message}`);
    }
  }
}
