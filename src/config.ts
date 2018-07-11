import * as path from "path";
import * as fs from "fs";
import * as process from "process";
import chalk from "chalk";
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
}

const DEFAULT_MODULE_INFO: Partial<ModuleInfo> = {
  npmInstall: true,
  buildCommands: []
};

export interface Config {
  modulesDirectory: string;
  modules: ModuleInfo[];
  app: AppConfig;
}

export interface AppConfig {
  home: string;
  forceModules: string[];
}

const DEFAULT_CONFIG: Partial<Config> = {
  modules: []
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
      config = Object.assign(DEFAULT_CONFIG, JSON.parse(rawConfig));
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
      branch
    }) as ModuleInfo;
  }

  if (!moduleConfig.name) {
    moduleConfig.name = gitUrlParse(moduleConfig.repository).full_name
  }

  moduleConfig.branch = branch;

  if (!moduleConfig.npmName) {
    moduleConfig.npmName = npmNameFromPackageName(moduleConfig.name);
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
