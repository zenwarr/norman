import * as chokidar from "chokidar";
import * as chalk from "chalk";
import * as path from "path";
import * as fs from "fs-extra";
import { ModuleOperator } from "./base";
import { IGNORE_REGEXPS, ModuleInfo } from "./module-info";
import { ModuleSynchronizer } from "./module-synchronizer";
import { EventEmitter } from "events";
import luxon = require("luxon");


export class ModulesFeeder {
  public constructor(private _modulesToFeed: ModuleInfo[]) {

  }


  public async start(): Promise<void> {
    for (let moduleToFeed of this._modulesToFeed) {
      let localDeps = moduleToFeed.getLocalDependencies(true);
      for (let localDep of localDeps) {
        await this.createWatcher(localDep, moduleToFeed);
      }
    }
  }


  public async stop(): Promise<void> {
    for (let key of Object.keys(this._pool)) {
      let watcher = this._pool[key]!;
      watcher.clearSyncTargets();
      await watcher.stop();
      delete this._pool[key];
    }
  }


  protected _pool: { [name: string]: ModuleWatcher | undefined } = {};


  protected async createWatcher(module: ModuleInfo, targetModule: ModuleInfo): Promise<ModuleWatcher> {
    let existingWatcher = this._pool[module.name];
    if (existingWatcher) {
      await existingWatcher.addSyncTarget(targetModule);
      return existingWatcher;
    } else {
      let watcher = new ModuleWatcher(module);
      watcher.addDepsChangedHandler(this.onDepsChanged.bind(this, module));
      await watcher.addSyncTarget(targetModule);
      await watcher.watch();
      this._pool[module.name] = watcher;
      return watcher;
    }
  }


  protected removeWatcher(module: ModuleInfo, targetModule: ModuleInfo): void {
    let existingWatcher = this._pool[module.name];
    if (existingWatcher) {
      existingWatcher.removeSyncTarget(targetModule);
    }
  }


  protected async onDepsChanged(module: ModuleInfo): Promise<void> {
    console.log(`Dependencies of module ${ module.name } has changed, reinstalling it in dependent modules...`);
    await this.stop();
    await this.start();
  }
}


/**
 * Watches source code of a module for changes and synchronizes it to given targets.
 */
export class ModuleWatcher extends ModuleOperator {
  public constructor(module: ModuleInfo) {
    super(module);
  }


  public async addSyncTarget(target: ModuleInfo): Promise<void> {
    let targetPath = path.join(target.path, "node_modules", this.module.name);
    let synchronizer = new ModuleSynchronizer(target);
    await synchronizer.sync(false);
    this._syncTargets.push(targetPath);
  }


  public removeSyncTarget(target: ModuleInfo): void {
    let targetPath = path.join(target.path, "node_modules", this.module.name);
    this._syncTargets = this._syncTargets.filter(x => x !== targetPath);
  }


  public async watch(): Promise<void> {
    if (this._watcher) {
      return;
    }

    let synchronizer = new ModuleSynchronizer(this.module);
    await synchronizer.sync(false);

    let watcher = chokidar.watch(this.module.path, {
      ignored: IGNORE_REGEXPS,
      followSymlinks: false,
      atomic: true,
      ignoreInitial: true
    });

    watcher.on("add", this.onAddFile.bind(this));
    watcher.on("change", this.onChangeFile.bind(this));
    watcher.on("unlink", this.onRemoveFile.bind(this));
    watcher.on("addDir", this.onAddDir.bind(this));
    watcher.on("unlinkDir", this.onRemoveDir.bind(this));
    watcher.on("error", error => console.log(chalk.red(`watcher error: ${ error.message }`)));

    this._watcher = watcher;
  }


  public async stop(): Promise<void> {
    if (this._watcher) {
      await this._watcher.close();
      this._watcher = null;
    }
  }


  public clearSyncTargets(): void {
    this._syncTargets = [];
  }


  protected async onAddFile(sourceFilePath: string) {
    if (!this._watcher) {
      return;
    }

    try {
      if (!this.module.isFileShouldBePublished(sourceFilePath)) {
        return;
      }

      for (let syncTarget of this._syncTargets || []) {
        let targetFiles = await this.copyFile(syncTarget, sourceFilePath);
        this.logChange("NEW", sourceFilePath, syncTarget, targetFiles);
      }
    } catch (error) {
      console.log(chalk.yellow(`Error (ADD): ${ error.message }`));
    }
  }


  protected async onChangeFile(sourceFilePath: string) {
    if (!this._watcher) {
      return;
    }

    try {
      if (!this.module.isFileShouldBePublished(sourceFilePath)) {
        return;
      }

      for (let syncTarget of this._syncTargets || []) {
        let targetFiles = await this.copyFile(syncTarget, sourceFilePath);
        this.logChange("UPD", sourceFilePath, syncTarget, targetFiles);
      }
    } catch (error) {
      console.log(chalk.yellow(`Error (UPD): ${ error.message }`));
    }
  }


  protected async onRemoveFile(sourceFilePath: string) {
    if (!this._watcher) {
      return;
    }

    try {
      if (!this.module.isFileShouldBePublished(sourceFilePath)) {
        return;
      }

      let relpath = path.relative(this.module.path, sourceFilePath);

      for (let syncTarget of this._syncTargets || []) {
        let targetFilePath = path.join(syncTarget, relpath);

        fs.unlinkSync(targetFilePath);
        this.logChange("DEL", sourceFilePath, syncTarget, targetFilePath);
      }
    } catch (error) {
      console.log(chalk.yellow(`Error (DEL): ${ error.message }`));
    }
  }


  protected async onAddDir(sourceFilePath: string) {
    if (!this._watcher) {
      return;
    }

    try {
      if (!this.module.isFileShouldBePublished(sourceFilePath)) {
        return;
      }

      let relpath = path.relative(this.module.path, sourceFilePath);
      if (!relpath) { // root module directory, skip it
        return;
      }

      for (let syncTarget of this._syncTargets || []) {
        let targetFilePath = path.join(syncTarget, relpath);
        let fileMode = fs.statSync(sourceFilePath).mode;
        fs.mkdirpSync(targetFilePath);
        fs.chmodSync(targetFilePath, fileMode);
        this.logChange("NEW", sourceFilePath, syncTarget, targetFilePath);
      }
    } catch (error) {
      console.log(chalk.yellow(`Error (ADD): ${ error.message }`));
    }
  }


  protected async onRemoveDir(sourceFilePath: string) {
    if (!this._watcher) {
      return;
    }

    try {
      if (!this.module.isFileShouldBePublished(sourceFilePath)) {
        return;
      }

      for (let syncTarget of this._syncTargets || []) {
        let targetFilePath = path.join(syncTarget, path.relative(this.module.path, sourceFilePath));
        fs.removeSync(targetFilePath);
        this.logChange("DEL", sourceFilePath, syncTarget, targetFilePath);
      }
    } catch (error) {
      console.log(chalk.yellow(`Error (DEL): ${ error.message }`));
    }
  }


  protected logChange(event: string, sourceFilePath: string, moduleAppPath: string, targetFiles: string | string[]): void {
    if (!Array.isArray(targetFiles)) {
      targetFiles = [ targetFiles ];
    }

    let ts = luxon.DateTime.local().toLocaleString(luxon.DateTime.TIME_24_WITH_SECONDS);

    targetFiles.forEach(targetFilePath => console.log(`${ ts } ${ event }: [${ this.module.name }] ${ path.relative(moduleAppPath, targetFilePath) }`));
  }


  protected async copyFile(targetModulePath: string, sourceFilePath: string): Promise<string[]> {
    let relpath = path.relative(this.module.path, sourceFilePath);
    let targetFilePath = path.join(targetModulePath, relpath);

    if (relpath === "package.json") {
      this.onDepsChanged();
      return [];
    }

    await this.module.copyFile(sourceFilePath, targetFilePath);
    return [ targetFilePath ];
  }


  protected onDepsChanged(): void {
    this._eventEmitter.emit("depsChanged");
  }


  public addDepsChangedHandler(handler: () => void): void {
    this._eventEmitter.addListener("depsChanged", handler);
  }


  protected _syncTargets: string[] = [];
  protected _watcher: chokidar.FSWatcher | null = null;
  protected _eventEmitter: EventEmitter = new EventEmitter();
}
