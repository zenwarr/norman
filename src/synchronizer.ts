import {Config, ModuleInfo} from "./config";
import * as path from "path";
import * as fs from "fs-extra";
import chalk from "chalk";
import * as chokidar from "chokidar";
import * as semver from "semver";
import * as utils from "./utils";


interface DepInfo {
  name: string;
  version: string;
}

interface ModuleDepInfo {
  name: string;
  semver: string;
}

interface ConflictInfo {
  name: string;
  version: string;
  semver: string;
  installed: boolean;
}


const IGNORE_REGEXPS = [
  /node_modules$/,
  /.git$/,
  /.idea$/
];


export default class ModuleSynchronizer {
  constructor(protected config: Config) {

  }

  async start(): Promise<void> {
    let watchingCount = 0;

    if (!fs.existsSync(path.join(this.config.app.home, "node_modules"))) {
      console.log(chalk.red(`No "node_modules" directory exist in app directory, run "npm install" before starting norman`));
      return;
    }

    let hasConflicts = false;
    for (let module of this.config.modules) {
      hasConflicts = hasConflicts || !await this.handleConflicts(module);
    }

    if (hasConflicts) {
      console.log(chalk.red(`Modules are not synchronized because of conflicts`));
      return;
    }

    for (let module of this.config.modules) {
      if (this.watchModule(module)) {
        ++watchingCount;
      }
    }

    if (!watchingCount) {
      console.log(chalk.yellow(`No modules were synchronized for app at "${this.config.app.home}". Use "app.forceModules" to list required modules or run "npm install" in app directory`));
    } else {
      console.log(chalk.green(`Watching for changes in ${watchingCount} modules...`));
    }
  }

  initialSyncDone(module: ModuleInfo) {
    return this.initedModules.indexOf(module.name) >= 0;
  }

  protected initedModules: string[] = [ ];
  protected watchers: { [name: string]: chokidar.FSWatcher|undefined } = { };

  protected async copyFile(module: ModuleInfo, moduleAppPath: string, sourceFilePath: string): Promise<string[]> {
    let relpath = path.relative(module.path, sourceFilePath);
    let targetFilePath = path.join(moduleAppPath, relpath);

    let loadedContent: string|undefined = undefined;
    for (let plugin of this.config.pluginInstances) {
      if (plugin.matches(sourceFilePath, module)) {
        if (loadedContent == null) {
          loadedContent = fs.readFileSync(sourceFilePath, { encoding: "utf-8" });
        }

        let resultFiles = await plugin.transform(loadedContent, sourceFilePath, targetFilePath, module);
        for (let resultFile of resultFiles) {
          fs.writeFileSync(resultFile.filename, resultFile.content, { encoding: "utf-8" });
        }

        return resultFiles.map(resultFile => resultFile.filename);
      }
    }

    fs.copyFileSync(sourceFilePath, targetFilePath);
    return [ targetFilePath ];
  }

  protected async onAddFile(module: ModuleInfo, moduleAppPath: string, sourceFilePath: string) {
    let syncDone = this.initialSyncDone(module);
    let targetFiles = await this.copyFile(module, moduleAppPath, sourceFilePath);
    if (syncDone) {
      this.logChange(module, "NEW", sourceFilePath, moduleAppPath, targetFiles);
    }
  }

  protected async onChangeFile(module: ModuleInfo, moduleAppPath: string, sourceFilePath: string) {
    let syncDone = this.initialSyncDone(module);
    let targetFiles = await this.copyFile(module, moduleAppPath, sourceFilePath);
    if (syncDone) {
      this.logChange(module, "UPD", sourceFilePath, moduleAppPath, targetFiles);
    }
  }

  protected async onRemoveFile(module: ModuleInfo, moduleAppPath: string, sourceFilePath: string) {
    let relpath = path.relative(module.path, sourceFilePath);
    let targetFilePath = path.join(moduleAppPath, relpath);

    for (let plugin of this.config.pluginInstances) {
      if (plugin.matches(sourceFilePath, module)) {
        plugin.clean(sourceFilePath, targetFilePath, module);
      }
    }

    fs.unlinkSync(targetFilePath);
    this.logChange(module, "DEL", sourceFilePath, moduleAppPath, targetFilePath);
  }

  protected async onAddDir(module: ModuleInfo, moduleAppPath: string, sourceFilePath: string) {
    let relpath = path.relative(module.path, sourceFilePath);
    if (!relpath) { // root module directory, skip it
      return;
    }

    let targetFilePath = path.join(moduleAppPath, relpath);
    fs.copySync(sourceFilePath, targetFilePath);
    this.logChange(module, "NEW", sourceFilePath, moduleAppPath, targetFilePath);
  }

  protected async onRemoveDir(module: ModuleInfo, moduleAppPath: string, sourceFilePath: string) {
    let targetFilePath = path.join(moduleAppPath, path.relative(module.path, sourceFilePath));
    fs.removeSync(targetFilePath);
    this.logChange(module, "DEL", sourceFilePath, moduleAppPath, targetFilePath);
  }

  protected logChange(module: ModuleInfo, event: string, sourceFilePath: string, moduleAppPath: string, targetFiles: string|string[]): void {
    if (this.initialSyncDone(module)) {
      if (!Array.isArray(targetFiles)) {
        targetFiles = [targetFiles];
      }

      targetFiles.forEach(targetFilePath => console.log(`${event}: [${module.name}] ${path.relative(moduleAppPath, targetFilePath)}`));
    }
  }

  protected getAppInstalledDeps(): DepInfo[] {
    const getDepsFromDir = (dir: string): DepInfo[] => {
      let filenames = fs.readdirSync(dir, { encoding: "utf-8" }) as string[];

      let result: DepInfo[] = [];

      for (let filename of filenames) {
        let filePath = path.join(dir, filename);
        if (filename.startsWith(".") || !fs.statSync(filePath).isDirectory()) {
          continue;
        }

        if (filename.startsWith("@")) {
          result = result.concat(getDepsFromDir(filePath));
          continue;
        }

        try {
          let pkgPath = require.resolve(path.join(dir, filename, "package.json"));
          delete require.cache[pkgPath];
          let pkg = require(pkgPath);
          result.push({
            name: pkg.name,
            version: pkg.version
          });
        } catch (error) {
          // do nothing
        }
      }

      return result;
    };

    return getDepsFromDir(path.join(this.config.app.home, "node_modules"));
  }

  protected getModuleDeps(module: ModuleInfo): ModuleDepInfo[] {
    try {
      let pkgPath = require.resolve(path.join(module.path, "package.json"));
      delete require.cache[pkgPath];
      let pkg = require(pkgPath);
      return Object.keys(pkg.dependencies || { }).map(name => ({
        name,
        semver: pkg.dependencies[name]
      }));
    } catch (error) {
      console.log(chalk.yellow(`Failed to get dependencies for module [${module.name}]: ${error.message}`));
      return [];
    }
  }

  protected findModuleConflicts(module: ModuleInfo, cachedAppDeps?: DepInfo[]): ConflictInfo[] {
    let appDeps = cachedAppDeps || this.getAppInstalledDeps();

    let moduleDeps = this.getModuleDeps(module).filter(dep => {
      return !dep.name.startsWith("@types/") &&
          this.config.modules.find(mod => mod.npmName.name === dep.name) == null;
    });

    let conflicts: ConflictInfo[] = [];
    for (let moduleDep of moduleDeps) {
      let installedDep = appDeps.find(dep => dep.name === moduleDep.name);
      if (!installedDep) {
        conflicts.push({
          name: moduleDep.name,
          version: '?',
          semver: moduleDep.semver,
          installed: false
        });
      } else if (!semver.satisfies(installedDep.version, moduleDep.semver)) {
        conflicts.push({
          name: moduleDep.name,
          version: installedDep.version,
          semver: moduleDep.semver,
          installed: true
        });
      }
    }

    return conflicts;
  }

  protected async resolveConflict(conflict: ConflictInfo, module: ModuleInfo): Promise<boolean> {
    if (!conflict.installed && this.config.installMissingAppDeps) {
      // module is missing, we can fix that
      let packageSpec = `${conflict.name}@${conflict.semver}`;
      console.log(chalk.yellow(`RESOLVE CONFLICT: installing "${packageSpec}" into app directory (required by [${module.name}])`));
      await utils.runCommand("npm", [ "install", packageSpec, "--no-save" ], {
        cwd: this.config.app.home,
        env: process.env
      });
      return true;
    }

    return false;
  }

  /**
   * Returns true if all conflicts are resolved, false if there is at least one unresolved conflict.
   * @param module
   */
  async handleConflicts(module: ModuleInfo): Promise<boolean> {
    let conflicts: ConflictInfo[] = [ ];

    for (let conflict of await this.findModuleConflicts(module)) {
      if (!await this.resolveConflict(conflict, module)) {
        conflicts.push(conflict);
      }
    }

    if (conflicts.length) {
      this.logConflicts(conflicts, module);
      return false;
    }

    return true;
  }

  protected logConflicts(conflicts: ConflictInfo[], module: ModuleInfo): void {
    for (let conflict of conflicts) {
      if (!conflict.installed) {
        console.log(chalk.red(`CONFLICT: package "${conflict.name}" (${conflict.semver}) is required by module [${module.name}], but not installed in app`));
      } else {
        console.log(chalk.red(
            `CONFLICT: package "${conflict.name}" is required by module [${module.name}], but app has incompatible version installed.
          Required: ${conflict.semver}, installed: ${conflict.version}`
        ));
      }
    }
  }

  public async resyncApp(): Promise<void> {
    this.config.modules.forEach(this.resyncModule.bind(this));
  }

  public async resyncModule(module: ModuleInfo): Promise<void> {
    let watcher = this.watchers[module.name];
    if (watcher) {
      watcher.close();
      delete this.watchers[module.name];
    }

    this.initedModules = this.initedModules.filter(moduleName => moduleName !== module.name);
    this.watchModule(module, false);
  }

  protected watchModule(module: ModuleInfo, logSkipped: boolean = true): boolean {
    let moduleAppPath = path.join(this.config.app.home, "node_modules", module.npmName.name);

    let forceModules = this.config.app.forceModules;
    if (forceModules.indexOf(module.name) >= 0 || forceModules.indexOf(module.npmName.name) >= 0 || fs.existsSync(moduleAppPath)) {
      console.log(chalk.green(`SYNCED: ${module.path} → ${moduleAppPath}`));

      fs.mkdirpSync(moduleAppPath);
      fs.emptyDirSync(moduleAppPath);

      let watcher = chokidar.watch(module.path, {
        ignored: IGNORE_REGEXPS,
        followSymlinks: false,
        awaitWriteFinish: true,
        atomic: true
      });

      watcher.on("add", this.onAddFile.bind(this, module, moduleAppPath));
      watcher.on("change", this.onChangeFile.bind(this, module, moduleAppPath));
      watcher.on("unlink", this.onRemoveFile.bind(this, module, moduleAppPath));
      watcher.on("addDir", this.onAddDir.bind(this, module, moduleAppPath));
      watcher.on("unlinkDir", this.onRemoveDir.bind(this, module, moduleAppPath));
      watcher.on("error", error => console.log(`error: ${error.message}`));
      watcher.on("ready", () => this.initedModules.push(module.name));

      this.watchers[module.name] = watcher;

      return true;
    } else {
      if (logSkipped) {
        console.log(`Skipping sync for ${module.npmName.name}, directory "${moduleAppPath}" does not exist and the module is not listed in "app.forceModules"`);
      }

      return false;
    }
  }
}
