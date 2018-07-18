import * as path from "path";
import * as fs from "fs";
import * as process from "process";
import chalk from "chalk";
import {CoffeeScriptPlugin, Plugin, IPluginClass, PackagePlugin, SourceMapPlugin} from "./plugins";

const gitUrlParse = require("git-url-parse");

export interface ModuleNpmName {
  org: string;
  pkg: string;
  name: string;
}

export interface ModuleInfo {
  name: string;
  npmName: ModuleNpmName;
  repository: string;
  npmInstall: boolean;
  buildCommands: string[];
  branch: string;
  path: string;
  ignoreOrg: boolean;
}

const DEFAULT_MODULE_INFO: Partial<ModuleInfo> = {
  npmInstall: true,
  buildCommands: []
};

export interface Config {
  modulesDirectory: string;
  modules: ModuleInfo[];
  defaultIgnoreOrg: boolean;
  app: AppConfig;
  pluginClasses: IPluginClass[];
  pluginInstances: Plugin[];
  installMissingAppDeps: boolean;
}

export interface AppConfig {
  home: string;
  forceModules: string[];
}


const DEFAULT_PLUGINS: IPluginClass[]  = [ CoffeeScriptPlugin, SourceMapPlugin, PackagePlugin ];


const DEFAULT_CONFIG: Partial<Config> = {
  modules: [],
  defaultIgnoreOrg: false,
  pluginClasses: [ ],
  pluginInstances: [ ],
  installMissingAppDeps: false
};

const CONFIG_FILE_NAME = ".norman.json";


export function loadConfig(): Config {
  const loadFromDir = (dir: string): Config => {
    if (!dir || dir === "/" || dir === ".") {
      throw new Error(`No ${CONFIG_FILE_NAME} found in directory tree`);
    }

    let configLocation = path.join(dir, CONFIG_FILE_NAME);

    let rawConfig: string;
    try {
      rawConfig = fs.readFileSync(configLocation, {
        encoding: "utf-8"
      });
    } catch (error) {
      // no file found, go level up
      return loadFromDir(path.dirname(dir));
    }

    let config: any;
    try {
      config = Object.assign({}, DEFAULT_CONFIG, JSON.parse(rawConfig));
    } catch (error) {
      // invalid config, stop here
      throw new Error(`Invalid config file ${configLocation}: ${error.message}`);
    }

    if (!config.modulesDirectory) {
      throw new Error(`No valid "modulesDirectory" option found in configuration file loaded from ${configLocation}`);
    }

    // make modulesDirectory absolute
    if (!path.isAbsolute(config.modulesDirectory)) {
      config.modulesDirectory = path.resolve(dir, config.modulesDirectory);
    }

    // build module list from urls
    config.modules = config.modules.map(moduleFromConfig.bind(null, config));

    if (config.includeModules) {
      let includeModules = Array.isArray(config.includeModules) ? config.includeModules : [ config.includeModules ];
      for (let includeConfig of includeModules) {
        if (!path.isAbsolute(includeConfig)) {
          includeConfig = path.resolve(dir, includeConfig);
        }
        try {
          let extraModules = loadModulesFromConfig(includeConfig).filter(extraModule => {
            // ignore conflicting modules
            if (config.modules.find((module: ModuleInfo) => module.repository === extraModule.repository) != null) {
              console.log(chalk.yellow(`Ignoring module "${extraModule.repository}" because it has been already loaded`));
              return false;
            }
            return true;
          });
          config.modules = config.modules.concat(extraModules);
        } catch (error) {
          throw new Error(`Failed to include modules from config at "${includeConfig}" (while parsing config at "${configLocation}": ${error.message}`);
        }
      }
    }

    // register plugins
    for (let pluginModule of config.plugins || []) {
      registerPlugin(config, pluginModule);
    }

    config.pluginClasses = config.pluginClasses.concat(DEFAULT_PLUGINS);

    if (!config.app) {
      config.app = { };
    }

    if (!config.app.home) {
      // consider this directory should be a root application directory
      config.app.home = dir;
      console.log(chalk.yellow(`You have no "app" or "app.home" in your ".norman.json" file, considering "${dir}" to be home`));
    } else if (!path.isAbsolute(config.app.home)) {
      config.app.home = path.resolve(dir, config.app.home);
    }

    if (!config.app.forceModules) {
      config.app.forceModules = [ ];
    }

    return config;
  };

  return loadFromDir(process.cwd());
}


function moduleFromConfig(inputConfig: any, moduleConfig: any): ModuleInfo {
  let branch = moduleConfig.branch || inputConfig.defaultBranch || "master";

  if (typeof moduleConfig === "string") {
    let fullName = gitUrlParse(moduleConfig).full_name;
    return Object.assign({}, DEFAULT_MODULE_INFO, {
      repository: moduleConfig,
      name: fullName,
      npmName: npmNameFromPackageName(fullName),
      branch,
      path: path.join(inputConfig.modulesDirectory, fullName),
      ignoreOrg: false
    }) as ModuleInfo;
  }

  let fullName = gitUrlParse(moduleConfig.repository).full_name;
  if (!moduleConfig.name) {
    moduleConfig.name = fullName;
  }

  moduleConfig.branch = branch;

  if (!moduleConfig.npmName) {
    moduleConfig.npmName = npmNameFromPackageName(moduleConfig.name);
  }

  if (moduleConfig.ignoreOrg == null) {
    moduleConfig.ignoreOrg = inputConfig.defaultIgnoreOrg != null ? inputConfig.defaultIgnoreOrg : false;
  }

  if (!moduleConfig.path) {
    moduleConfig.path = path.join(inputConfig.modulesDirectory, moduleConfig.ignoreOrg ? moduleConfig.npmName.pkg : fullName);
  } else if (!path.isAbsolute(moduleConfig.path)) {
    throw new Error(`Path for module ${fullName} has to be absolute: ${moduleConfig.path}`);
  }

  return Object.assign({}, DEFAULT_MODULE_INFO, moduleConfig);
}


function npmNameFromPackageName(name: string): ModuleNpmName {
  if (name.indexOf("/") > 0) {
    let [ org, pkg ] = name.split("/");
    return { org, pkg, name: `@${org}/${pkg}` };
  } else {
    return { org: "", pkg: name, name };
  }
}


function loadModulesFromConfig(file: string): ModuleInfo[] {
  if (fs.statSync(file).isDirectory()) {
    file = path.join(file, CONFIG_FILE_NAME);
  }

  let rawConfig = fs.readFileSync(file, {
    encoding: "utf-8"
  });

  let config: any;
  try {
    config = Object.assign({}, DEFAULT_CONFIG, JSON.parse(rawConfig));
  } catch (error) {
    // invalid config, stop here
    throw new Error(`Invalid config file ${file}: ${error.message}`);
  }

  // register plugins
  for (let pluginModule of config.plugins || []) {
    registerPlugin(config, pluginModule);
  }

  if (!config.modulesDirectory) {
    throw new Error(`No valid "modulesDirectory" option found in configuration file loaded from ${file}`);
  }

  // make modulesDirectory absolute
  if (!path.isAbsolute(config.modulesDirectory)) {
    config.modulesDirectory = path.resolve(path.dirname(file), config.modulesDirectory);
  }

  // build module list from urls
  return config.modules.map(moduleFromConfig.bind(null, config));
}


function registerPlugin(config: Config, moduleName: string): void {
  if (!moduleName) {
    return;
  }

  let module = require(moduleName);
  if (!module.default) {
    throw new Error(`Failed to import transformer module ${moduleName}: use "export default" to export plugin class`);
  }

  config.pluginClasses.push(module.default);
}
