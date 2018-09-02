import * as path from "path";
import * as fs from "fs-extra";
import * as utils from "./utils";
import {Config, ModuleInfo} from "./config";
import {Norman} from "./norman";
import * as chokidar from "chokidar";
import chalk from "chalk";
import {ModuleStateManager} from "./module-state-manager";


const IGNORE_REGEXPS = [
  /node_modules$/,
  /.git$/,
  /.idea$/,
  /\/.npmrc-norman-backup$/,
  /\/package-lock.norman-backup.json$/
];


export class AppSynchronizer {
  constructor(protected norman: Norman) {

  }


  get config(): Config {
    return this.norman.config;
  }


  protected clearSyncTargets(): void {
    for (let localModule of this.config.modules) {
      localModule.syncTargets = [];
    }
  }


  protected updateSyncTargets(): void {
    let syncTargets = 0,
        syncingModules: string[] = [];

    for (let localModule of this.config.modules) {
      localModule.syncTargets = [ ];
      for (let module of this.config.modules) {
        if (module.liveDeps && this.moduleDependsOn(module, localModule)) {
          localModule.syncTargets.push(path.join(module.path, "node_modules", localModule.npmName.name));
          ++syncTargets;

          console.log(`${localModule.npmName.name} -> ${localModule.syncTargets[localModule.syncTargets.length - 1]}`);

          if (syncingModules.indexOf(localModule.npmName.name) < 0) {
            syncingModules.push(localModule.npmName.name);
          }
        }
      }
    }

    console.log(chalk.green(`sync targets updated, ${syncTargets} targets in modules ${syncingModules.join(", ")}`));
  }


  async start(): Promise<void> {
    this.updateSyncTargets();

    let watchingCount = 0;

    for (let module of this.config.modules) {
      if (this.watchModule(module)) {
        ++watchingCount;
      }
    }

    console.log(chalk.green(`Watching for changes in ${watchingCount} modules`));
  }


  protected moduleDependsOn(module: ModuleInfo, dep: ModuleInfo): boolean {
    return fs.existsSync(path.join(module.path, "node_modules", dep.npmName.name));
  }


  protected async copyFile(module: ModuleInfo, moduleAppPath: string, sourceFilePath: string): Promise<string[]> {
    let relpath = path.relative(module.path, sourceFilePath);
    let targetFilePath = path.join(moduleAppPath, relpath);

    if (relpath == "package.json") {
      console.log(chalk.green(`Dependencies of module ${module.npmName.name} has changed, reinstalling it in dependent modules...`));

      let hasDependants = false;

      this.clearSyncTargets();

      try {
        // re-install this module in all modules that depend on it
        for (let localModule of this.config.modules) {
          if (localModule.liveDeps && this.moduleDependsOn(localModule, module)) {
            hasDependants = true;
            await this.norman.localNpmServer.installLocalModule(localModule, module);
          }
        }
      } finally {
        this.updateSyncTargets();
      }

      return [ ];
    }

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

  initialSyncDone(module: ModuleInfo) {
    return this.initedModules.indexOf(module.name) >= 0;
  }

  protected initedModules: string[] = [ ];
  protected watchers: { [name: string]: chokidar.FSWatcher|undefined } = { };
  protected ignoreInstances: { [name: string]: any } = { };

  protected isIgnored(module: ModuleInfo, sourceFilePath: string): boolean {
    if (this.ignoreInstances[module.name]) {
      return this.ignoreInstances[module.name].ignores(sourceFilePath);
    }
    return false;
  }

  protected async onAddFile(module: ModuleInfo, sourceFilePath: string) {
    if (this.isIgnored(module, sourceFilePath)) {
      return;
    }

    let syncDone = this.initialSyncDone(module);
    for (let syncTarget of module.syncTargets || []) {
      let targetFiles = await this.copyFile(module, syncTarget, sourceFilePath);
      if (syncDone) {
        this.logChange(module, "NEW", sourceFilePath, syncTarget, targetFiles);
      }
    }
  }

  protected async onChangeFile(module: ModuleInfo, sourceFilePath: string) {
    if (this.isIgnored(module, sourceFilePath)) {
      return;
    }

    let syncDone = this.initialSyncDone(module);
    for (let syncTarget of module.syncTargets || []) {
      let targetFiles = await this.copyFile(module, syncTarget, sourceFilePath);
      if (syncDone) {
        this.logChange(module, "UPD", sourceFilePath, syncTarget, targetFiles);
      }
    }
  }

  protected async onRemoveFile(module: ModuleInfo, sourceFilePath: string) {
    if (this.isIgnored(module, sourceFilePath)) {
      return;
    }

    let relpath = path.relative(module.path, sourceFilePath);

    for (let syncTarget of module.syncTargets || []) {
      let targetFilePath = path.join(syncTarget, relpath);

      for (let plugin of this.config.pluginInstances) {
        if (plugin.matches(sourceFilePath, module)) {
          plugin.clean(sourceFilePath, targetFilePath, module);
        }
      }

      fs.unlinkSync(targetFilePath);
      this.logChange(module, "DEL", sourceFilePath, syncTarget, targetFilePath);
    }
  }

  protected async onAddDir(module: ModuleInfo, sourceFilePath: string) {
    if (this.isIgnored(module, sourceFilePath)) {
      return;
    }

    let relpath = path.relative(module.path, sourceFilePath);
    if (!relpath) { // root module directory, skip it
      return;
    }

    for (let syncTarget of module.syncTargets || []) {
      let targetFilePath = path.join(syncTarget, relpath);
      let fileMode = fs.statSync(sourceFilePath).mode;
      fs.mkdirpSync(targetFilePath);
      fs.chmodSync(targetFilePath, fileMode);
      this.logChange(module, "NEW", sourceFilePath, syncTarget, targetFilePath);
    }
  }

  protected async onRemoveDir(module: ModuleInfo, sourceFilePath: string) {
    if (this.isIgnored(module, sourceFilePath)) {
      return;
    }

    for (let syncTarget of module.syncTargets || []) {
      let targetFilePath = path.join(syncTarget, path.relative(module.path, sourceFilePath));
      fs.removeSync(targetFilePath);
      this.logChange(module, "DEL", sourceFilePath, syncTarget, targetFilePath);
    }
  }

  protected logChange(module: ModuleInfo, event: string, sourceFilePath: string, moduleAppPath: string, targetFiles: string|string[]): void {
    if (this.initialSyncDone(module)) {
      if (!Array.isArray(targetFiles)) {
        targetFiles = [targetFiles];
      }

      targetFiles.forEach(targetFilePath => console.log(`${event}: [${module.name}] ${path.relative(moduleAppPath, targetFilePath)}`));
    }
  }


  protected watchModule(module: ModuleInfo, logSkipped: boolean = true): boolean {
    let watcher = chokidar.watch(module.path, {
      ignored: IGNORE_REGEXPS,
      followSymlinks: false,
      awaitWriteFinish: true,
      atomic: true,
      ignoreInitial: true
    });

    watcher.on("add", this.onAddFile.bind(this, module));
    watcher.on("change", this.onChangeFile.bind(this, module));
    watcher.on("unlink", this.onRemoveFile.bind(this, module));
    watcher.on("addDir", this.onAddDir.bind(this, module));
    watcher.on("unlinkDir", this.onRemoveDir.bind(this, module));
    watcher.on("error", error => console.log(chalk.red(`watcher error: ${error.message}`)));
    watcher.on("ready", () => this.initedModules.push(module.name));

    this.watchers[module.name] = watcher;

    return true;
  }


  /**
   * - Enumerate local dependencies of the module
   * - For each dependency, do the following:
   * -   Build the module if `--build-deps` is true.
   * -   If the module is listed in `package.json`, but not installed, remember to run `npm install` in the end and go to the next module.
   * -   If the module is installed, check if it is actual:
   * -     Compare dependencies of the installed module with dependencies of the actual module.
   * -       If dependencies match, just copy source files to installed module and proceed to the next module.
   * -       If dependencies do not match, remove the installed module and remember to run `npm install`.
   * @param localModule
   */
  async syncModule(localModule: ModuleInfo, alreadyBuilt?: string[]): Promise<void> {
    console.log(chalk.green(`SYNC MODULE: ${localModule.npmName.name}`));

    if (!alreadyBuilt) {
      alreadyBuilt = [];
    }

    let localDependencies: ModuleInfo[] = [];

    let dependencies = utils.getPackageDeps(localModule.path);
    for (let dep of dependencies) {
      let localDependency = this.norman.getModuleInfo(dep);
      if (localDependency) {
        localDependencies.push(localDependency);
      }
    }

    await this.norman.localNpmServer.walkDependencyTree(localDependencies, async module => {
      if (this.norman.args.subCommand === "sync" && this.norman.args.buildDeps) {
        let stateManager = new ModuleStateManager(this.norman, module);
        if (await stateManager.isModuleChanged()) {
          for (let buildCommand of module.buildCommands) {
            if (alreadyBuilt!.find(m => m === module.npmName.name)) {
              return;
            }

            await this.syncModule(module, alreadyBuilt);

            await utils.runCommand("npm", [ "run", buildCommand ], {
              cwd: module.path
            });

            alreadyBuilt!.push(module.npmName.name);
          }

          await stateManager.saveActualState();
        }
      }
    });

    let runInstall = false;

    await this.norman.localNpmServer.walkDependencyTree(localDependencies, async module => {
      // check if module is installed into this module node_modules
      let installedPath = path.join(localModule.path, "node_modules", module.npmName.name);
      if (!fs.existsSync(installedPath)) {
        console.log(`Reinstalling dependencies because module ${module.npmName.name} is not installed`);
        runInstall = true;
        return;
      }

      // get deps of the installed modules
      let installedSubDeps = utils.getPackageDeps(installedPath, false).sort();
      let actualSubDeps = utils.getPackageDeps(module.path, false).sort();

      let depsEqual = installedSubDeps.length === actualSubDeps.length && installedSubDeps.every((dep, q) => dep === actualSubDeps[q]);
      if (depsEqual) {
        await this.painlessSyncInto(module, installedPath);
      } else {
        console.log(`Reinstalling dependencies because module ${module.npmName.name} dependencies have changed`);
        fs.removeSync(installedPath);
        runInstall = true;
      }
    });

    if (runInstall) {
      await this.norman.localNpmServer.installModuleDeps(localModule);
    }

    console.log(chalk.green(`SYNC DONE: ${localModule.npmName.name}`));
  }


  protected isPainlessIgnored(module: ModuleInfo, filepath: string): boolean {
    if (this.isIgnored(module, filepath)) {
      return true;
    }

    for (let ignoreRe of IGNORE_REGEXPS) {
      if (filepath.match(ignoreRe)) {
        return true;
      }
    }

    return false;
  }


  async walkModuleFiles(module: ModuleInfo, walker: (filename: string, state: fs.Stats) => Promise<void>): Promise<void> {
    const handle = async (source: string) => {
      if (this.isPainlessIgnored(module, source)) {
        return;
      }

      let sourceStat = fs.statSync(source);

      await walker(source, sourceStat);

      if (sourceStat.isDirectory()) {
        for (let filename of fs.readdirSync(source)) {
          await handle(path.join(source, filename));
        }
      }
    };

    return handle(module.path);
  }


  protected async painlessSyncInto(module: ModuleInfo, syncTarget: string): Promise<void> {
    return this.walkModuleFiles(module, async (filename: string, stat: fs.Stats) => {
      let target = path.join(syncTarget, path.relative(module.path, filename));

      if (!stat.isDirectory()) {
        let doCopy = false;

        let targetStat: fs.Stats|null = null;
        try {
          targetStat = fs.statSync(target);
          doCopy = stat.mtime.valueOf() > targetStat.mtime.valueOf();
        } catch (error) {
          doCopy = error.code === "ENOENT";
          if (error.code !== "ENOENT") {
            console.log(chalk.red(`Error while copying to ${target}: ${error.message}`));
          }
        }

        if (doCopy) {
          console.log(`${filename} -> ${target}`);
          fs.copySync(filename, target);
        }
      } else {
        fs.mkdirpSync(target);
      }
    });
  }
}
