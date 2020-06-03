import { Project } from "./project";
import * as path from "path";
import * as fs from "fs-extra";
import ignore, { Ignore } from "ignore";
import gitUrlParse = require("git-url-parse");
import { getPackageReader } from "./package-reader";


interface RawModuleConfig {
  branch?: unknown;
  name?: unknown;
  ignoreScope?: unknown;
  npmIgnore?: unknown;
  path?: unknown;
  repository?: unknown;
  buildCommands?: unknown;
  useNpm?: unknown;
  buildTriggers?: unknown;
}


export interface ModuleNpmName {
  scope: string | undefined;
  pkg: string;
  name: string;
}


export interface LocalModuleConfig {
  repository: string;
  branch: string;
  path: string;
  ignoreScope: boolean;
  name: ModuleNpmName | undefined;
  npmIgnorePath: string | undefined;
  buildTriggers: string[];
  buildCommands: string[];
  useNpm: boolean;
  isFromMainProject: boolean;
}


export class LocalModule {
  public get config() {
    return this._config;
  }

  public get name() {
    return this._config.name;
  }

  public get checkedName() {
    if (!this._config.name) {
      throw new Error(`Module at "${ this.path }" has no name defined, but it is required at this stage`);
    }

    return this._config.name;
  }

  public get path() {
    return this._config.path;
  }

  public get useNpm() {
    return this._config.useNpm;
  }

  public get buildTriggers() {
    return this._config.buildTriggers;
  }


  public constructor(private _config: LocalModuleConfig) {

  }


  public reloadInfo() {
    let rawName = LocalModule.tryReadPackageName(this.path);
    if (rawName) {
      this._config.name = npmNameFromPackageName(rawName);
    }
  }


  public static createFromConfig(rawConfig: RawModuleConfig, appConfig: Project, isFromMainProject: boolean, configDir: string): LocalModule {
    let repository: string;
    if ("repository" in rawConfig) {
      if (typeof rawConfig.repository !== "string") {
        throw new Error("'repository' should be a string");
      }
      repository = rawConfig.repository;
    } else {
      throw new Error("'repository' is missing");
    }

    let modulePath: string | undefined;
    if ("path" in rawConfig) {
      if (typeof rawConfig.path !== "string") {
        throw new Error("'path' should be a string");
      }
      modulePath = rawConfig.path;
      if (!path.isAbsolute(modulePath)) {
        modulePath = path.resolve(configDir, modulePath);
      }
    } else {
      const parsed = gitUrlParse(repository);
      modulePath = path.resolve(configDir, parsed.name);
    }

    let name: ModuleNpmName | undefined;
    if ("name" in rawConfig) {
      if (typeof rawConfig.name !== "string") {
        throw new Error("'name' should be a string");
      }
      name = npmNameFromPackageName(rawConfig.name);
    } else {
      let rawName = LocalModule.tryReadPackageName(modulePath);
      if (rawName) {
        name = npmNameFromPackageName(rawName);
      }
    }

    let branch = appConfig.defaultBranch;
    if ("branch" in rawConfig) {
      if (typeof rawConfig.branch !== "string") {
        throw new Error("'branch' should be a string");
      }
      branch = rawConfig.branch;
    }

    let ignoreScope = appConfig.defaultIgnoreScope;
    if ("ignoreScope" in rawConfig) {
      if (typeof rawConfig.ignoreScope !== "boolean") {
        throw new Error("'ignoreScope' should be a boolean");
      }
      ignoreScope = rawConfig.ignoreScope;
    }

    let npmIgnore = appConfig.defaultNpmIgnore;
    if ("npmIgnore" in rawConfig) {
      if (typeof rawConfig.npmIgnore !== "string") {
        throw new Error("'npmIgnore' should be a string");
      }
      npmIgnore = rawConfig.npmIgnore;
    }

    let npmIgnorePath = this.resolveIgnoreFromHint(npmIgnore, appConfig);

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

    let useNpm = appConfig.defaultUseNpm;
    if ("useNpm" in rawConfig) {
      if (typeof rawConfig.useNpm !== "boolean") {
        throw new Error("'useNpm' should be a boolean");
      }
      useNpm = rawConfig.useNpm;
    }

    let buildTriggers: string[] = appConfig.defaultBuildTriggers;
    if ("buildTriggers" in rawConfig) {
      if (!Array.isArray(rawConfig.buildTriggers)) {
        throw new Error("'buildTriggers' should be an array of strings");
      }
      buildTriggers = rawConfig.buildTriggers;
    }

    return new LocalModule({
      repository,
      name,
      buildCommands,
      branch,
      path: modulePath,
      ignoreScope,
      npmIgnorePath,
      useNpm,
      isFromMainProject,
      buildTriggers
    });
  }


  private static resolveIgnoreFromHint(ignorePath: string | undefined, appConfig: Project): string | undefined {
    let npmIgnorePath: string | undefined;
    if (ignorePath) {
      if (!path.isAbsolute(ignorePath)) {
        npmIgnorePath = path.resolve(appConfig.mainProjectDir, ignorePath);
      } else {
        npmIgnorePath = ignorePath;
      }
    }

    return npmIgnorePath;
  }


  private static tryReadPackageName(dir: string): string | undefined {
    let content = getPackageReader().readPackageMetadata(dir);
    if (!content) {
      return undefined;
    }

    const name = content.name;
    if (typeof name !== "string") {
      throw new Error(`Failed to read version of package at "${ dir }": looks like package.json file is invalid`);
    }

    return name;
  }


  public get customIgnoreInstance() {
    if (!this._customIgnoreInstance && this._config.npmIgnorePath) {
      let ignoreInstance = ignore();
      ignoreInstance.add(fs.readFileSync(this._config.npmIgnorePath, "utf-8"));
      this._customIgnoreInstance = ignoreInstance;
    }

    return this._customIgnoreInstance;
  }


  public get outsideIgnoreFilePath() {
    if (this.config.npmIgnorePath) {
      let relativePath = path.relative(this.path, this.config.npmIgnorePath);
      if (relativePath !== ".npmignore") {
        return this.config.npmIgnorePath;
      }
    }

    return undefined;
  }


  private _customIgnoreInstance: Ignore | undefined;
}


export function npmNameFromPackageName(name: string): ModuleNpmName {
  if (name.indexOf("/") > 0) {
    let [ org, pkg ] = name.split("/");
    if (org.startsWith("@")) {
      org = org.slice(1);
    }
    return { scope: org, pkg, name: `@${ org }/${ pkg }` };
  } else {
    return { scope: undefined, pkg: name, name };
  }
}
