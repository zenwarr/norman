import {ModuleInfo} from "./config";
import * as fs from "fs-extra";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import {Norman} from "./norman";


export type ModuleStateFiles = { [path: string]: number };


export interface ModuleState {
  module: string;
  timestamp: number;
  files: ModuleStateFiles;
}


const STATE_DIR = path.join(os.homedir(), ".norman");


export class ModuleStateManager {
  protected _module: ModuleInfo;
  protected _norman: Norman;


  constructor(norman: Norman, module: ModuleInfo) {
    this._module = module;
    this._norman = norman;
  }


  get norman(): Norman {
    return this._norman;
  }


  async loadActualState(): Promise<ModuleState> {
    const resultFiles: ModuleStateFiles = { };

    await this.norman.appSynchronizer.walkModuleFiles(this._module, async filename => {
      let stat = fs.statSync(filename);

      resultFiles[filename] = stat.mtime.valueOf();
    });

    return {
      module: this._module.npmName.name,
      timestamp: (new Date()).valueOf(),
      files: resultFiles
    }
  }


  async loadSavedState(): Promise<ModuleState|null> {
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
      throw new Error(`Invalid state file: ${stateFilePath}`);
    }

    let data = loadedState.data;
    if (!data || !Array.isArray(data)) {
      throw new Error(`Invalid state file: ${stateFilePath}`);
    }

    for (let entry of data as ModuleState[]) {
      if (entry.module === this._module.npmName.name) {
        return entry as ModuleState;
      }
    }

    return null;
  }


  async saveState(state: ModuleState): Promise<void> {
    let stateFilePath = this.pathToStateFile();

    let loadedState: { data: ModuleState[] }|null = null;
    try {
      loadedState = fs.readJSONSync(stateFilePath, {
        encoding: "utf-8"
      });
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    if (!loadedState) {
      loadedState = { data: [] };
    }

    let data: ModuleState[] = loadedState.data;
    if (!data || !Array.isArray(data)) {
      loadedState = { data: [] };
    }

    let existingStateFound = false;

    for (let q = 0; q < data.length; ++q) {
      if (data[q].module === this._module.npmName.name) {
        data[q] = state;
        existingStateFound = true;
        break;
      }
    }

    if (!existingStateFound) {
      data.push(state);
    }

    fs.outputJSONSync(stateFilePath, loadedState, {
      encoding: "utf-8",
      spaces: 2
    });
  }


  async saveActualState(): Promise<void> {
    return this.saveState(await this.loadActualState());
  }


  pathToStateFile(): string {
    let hash = crypto.createHmac("sha256", "norman").update(this.norman.config.mainConfigDir).digest('hex');
    return path.join(STATE_DIR, `state-${hash}.json`);
  }


  async isModuleChanged(): Promise<boolean> {
    let prevState = await this.loadSavedState();
    let currentState = await this.loadActualState();

    if (!prevState) {
      return true;
    }

    if (prevState.files.length !== currentState.files.length) {
      return true;
    }

    let files = Object.keys(prevState.files);
    for (let filename of files) {
      if (!currentState.files[filename] || currentState.files[filename] > prevState.files[filename]) {
        console.log(`module ${this._module.npmName.name} changed, file ${filename}`);
        return true;
      }
    }

    return false;
  }
}
