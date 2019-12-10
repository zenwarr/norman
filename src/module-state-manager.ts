import * as fs from "fs-extra";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import * as mimimatch from "minimatch";
import { ModuleOperator } from "./base";


export type ModuleStateFiles = { [path: string]: number };


export const BUILD_TAG = "build";
export const PACK_TAG = "pack";


export interface ModuleState {
  module: string;
  timestamp: number;
  files: ModuleStateFiles;
}


const STATE_DIR = path.join(os.homedir(), ".norman-state");


export class ModuleStateManager extends ModuleOperator {
  public async loadActualState(): Promise<ModuleState> {
    const resultFiles: ModuleStateFiles = {};

    await this.module.walkModuleFiles(async(filename, stat) => {
      resultFiles[filename] = stat.mtime.valueOf();
    });

    return {
      module: this.module.name,
      timestamp: (new Date()).valueOf(),
      files: resultFiles
    };
  }


  public async loadSavedState(stateTag: string): Promise<ModuleState | null> {
    let stateFilePath = this.pathToStateFile();

    let loadedState: any;
    try {
      loadedState = fs.readJSONSync(stateFilePath, {
        encoding: "utf-8"
      });
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      return null;
    }

    if (!loadedState) {
      throw new Error(`Invalid state file: ${ stateFilePath }`);
    }

    if (!(stateTag in loadedState)) {
      return null;
    }
    loadedState = loadedState[stateTag];

    let data = loadedState.data;
    if (!data || !Array.isArray(data)) {
      throw new Error(`Invalid state file: ${ stateFilePath }`);
    }

    for (let entry of data as ModuleState[]) {
      if (entry.module === this.module.name) {
        return entry;
      }
    }

    return null;
  }


  public async saveState(state: ModuleState, stateTag: string): Promise<void> {
    let stateFilePath = this.pathToStateFile();

    let loadedStateFile: { [name: string]: { data: ModuleState[] } | undefined } | null = null;
    try {
      loadedStateFile = fs.readJSONSync(stateFilePath, {
        encoding: "utf-8"
      });
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    if (!loadedStateFile) {
      loadedStateFile = {};
    }

    let stateForTag: { data: ModuleState[] } = loadedStateFile[stateTag] || { data: [] };

    if (!Array.isArray(stateForTag.data)) {
      stateForTag = { data: [] };
    }

    let existingStateFound = false;

    let data = stateForTag.data;

    for (let q = 0; q < data.length; ++q) {
      if (data[q].module === this.module.name) {
        data[q] = state;
        existingStateFound = true;
        break;
      }
    }

    if (!existingStateFound) {
      data.push(state);
    }

    loadedStateFile[stateTag] = stateForTag;

    fs.outputJSONSync(stateFilePath, loadedStateFile, {
      encoding: "utf-8"
    });
  }


  public async saveActualState(stateTag: string): Promise<void> {
    return this.saveState(await this.loadActualState(), stateTag);
  }


  public pathToStateFile(): string {
    let hash = crypto.createHash("sha256").update(this.module.path).digest("hex");
    return path.join(STATE_DIR, `state-${ hash }.json`);
  }


  public async needsRebuild(stateTag: string): Promise<boolean> {
    let prevState = await this.loadSavedState(stateTag);
    let currentState = await this.loadActualState();

    if (!prevState) {
      return true;
    }

    let prevStateBuildDeps = this.filterBuildTriggers(prevState.files);
    let currentStateBuildDeps = this.filterBuildTriggers(currentState.files);

    if (prevStateBuildDeps.length !== currentState.files.length) {
      return true;
    }

    for (let filename of Object.keys(prevStateBuildDeps)) {
      if (!currentStateBuildDeps[filename] || currentStateBuildDeps[filename] > prevStateBuildDeps[filename]) {
        console.log(`rebuilding ${ this.module.name }, detected change: ${ filename }`);
        return true;
      }
    }

    return false;
  }


  private filterBuildTriggers(stateFiles: ModuleStateFiles): ModuleStateFiles {
    let result: ModuleStateFiles = {};
    for (let filename of Object.keys(stateFiles)) {
      if (this.isBuildTrigger(filename)) {
        result[filename] = stateFiles[filename];
      }
    }
    return result;
  }


  private isBuildTrigger(filename: string): boolean {
    if (!this.module.buildTriggers || !this.module.buildTriggers.length) {
      return true;
    }

    for (let pattern of this.module.buildTriggers) {
      if (mimimatch(filename, pattern, { matchBase: true })) {
        return true;
      }
    }

    return false;
  }


  public static cleanState() {
    fs.removeSync(STATE_DIR);
  }
}
