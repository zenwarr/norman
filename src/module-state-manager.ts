import * as fs from "fs-extra";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { ModuleInfo } from "./module-info";
import { ModuleSubset } from "./module-subset";
import { BuildDependenciesSubset } from "./build-dependencies-subset";
import { ServiceLocator } from "./locator";
import { PublishDependenciesSubset } from "./publish-dependencies-subset";


export type SubsetFilesState = { [path: string]: number };


export interface ModuleState {
  module: string;
  timestamp: number;
  files: SubsetFilesState;
}


const STATE_DIR = path.join(os.homedir(), ".norman-state");


export class ModuleStateManager {
  /**
   * Calculates actual module state based on content of files currently on disc.
   * Module state is object that contains modification time for some subset of files inside a module.
   */
  public async getActualState(module: ModuleInfo): Promise<ModuleState> {
    const resultFiles: SubsetFilesState = {};

    await module.walkModuleFiles(async(filename, stat) => {
      if (this.isInAnySubset(module, filename)) {
        resultFiles[filename] = stat.mtime.valueOf();
      }
    });

    return {
      module: module.name,
      timestamp: (new Date()).valueOf(),
      files: resultFiles
    };
  }


  public getSavedState(module: ModuleInfo): ModuleState | null {
    const stateFilePath = this.getModuleStateFilePath(module);

    if (this._stateCache.has(stateFilePath)) {
      return this._stateCache.get(stateFilePath) || null;
    }

    let loadedState: any;
    try {
      loadedState = fs.readJSONSync(stateFilePath, {
        encoding: "utf-8"
      });
    } catch (error) {
      if (error.code === "ENOENT") {
        this._stateCache.set(stateFilePath, null);
        return null;
      }
      throw error;
    }

    if (!loadedState) {
      throw new Error(`Invalid state file: ${ stateFilePath }`);
    }

    this._stateCache.set(stateFilePath, loadedState);
    return loadedState;
  }


  public saveState(module: ModuleInfo, state: ModuleState): void {
    let stateFilePath = this.getModuleStateFilePath(module);

    fs.outputJSONSync(stateFilePath, state, {
      encoding: "utf-8"
    });

    this._stateCache.set(stateFilePath, state);
  }


  public async isSubsetChanged(module: ModuleInfo, subset: ModuleSubset): Promise<boolean> {
    let savedState = this.getSavedState(module);
    if (!savedState) {
      return true;
    }

    let actualSubsetState = this.getSubsetState(module, subset, await this.getActualState(module));
    const savedSubsetState = this.getSubsetState(module, subset, savedState);

    if (savedSubsetState.length !== actualSubsetState.length) {
      return true;
    }

    for (let filename of Object.keys(savedSubsetState)) {
      if (!actualSubsetState[filename] || actualSubsetState[filename] > savedSubsetState[filename]) {
        return true;
      }
    }

    return false;
  }


  public getSubsetState(module: ModuleInfo, subset: ModuleSubset, state: ModuleState): SubsetFilesState {
    const result: SubsetFilesState = {};

    for (const filename in state.files) {
      if (subset.isFileIncluded(module, filename)) {
        result[filename] = state.files[filename];
      }
    }

    return result;
  }


  public clearSavedState() {
    fs.removeSync(STATE_DIR);
  }


  public static init() {
    ServiceLocator.instance.initialize("stateManager", new ModuleStateManager());
  }


  private getModuleStateFilePath(module: ModuleInfo): string {
    let hash = crypto.createHash("sha256").update(module.path).digest("hex");
    return path.join(STATE_DIR, `state-${ hash }.json`);
  }


  private isInAnySubset(module: ModuleInfo, filename: string): boolean {
    return this._subsets.some(subset => subset.isFileIncluded(module, filename));
  }


  private _subsets: ModuleSubset[] = [ new BuildDependenciesSubset(), new PublishDependenciesSubset() ];
  private _stateCache = new Map<string, ModuleState | null>();
}


export function getStateManager() {
  return ServiceLocator.instance.get<ModuleStateManager>("stateManager");
}
