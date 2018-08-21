import {Config, ModuleInfo} from "./config";
import * as path from "path";
import chalk from "chalk";
import {Norman} from "./norman";

export interface TransformedFile {
  content: string;
  filename: string;
}

export type IPluginClass = { new(norman: Norman): Plugin };

export abstract class Plugin {
  constructor(protected norman: Norman) {

  }

  get config(): Config {
    return this.norman.config;
  }

  public abstract matches(filename: string, module: ModuleInfo): boolean;

  public abstract async transform(fileContent: string, sourceFilePath: string, targetFilePath: string, module: ModuleInfo): Promise<TransformedFile[]>;

  public clean(sourceFilePath: string, targetFilePath: string, module: ModuleInfo): string[] {
    return [ ];
  }
}


export class SourceMapPlugin extends Plugin {
  matches(filename: string, module: ModuleInfo): boolean {
    return filename.endsWith(".js.map");
  }

  async transform(fileContent: string, sourceFilePath: string, targetFilePath: string, module: ModuleInfo): Promise<TransformedFile[]> {
    let json = JSON.parse(fileContent);
    json.sourceRoot = path.dirname(sourceFilePath);

    return [
      {
        content: JSON.stringify(json),
        filename: targetFilePath
      }
    ];
  }
}


export class PackagePlugin extends Plugin {
  matches(filename: string, module: ModuleInfo): boolean {
    return filename.endsWith("package.json");
  }

  async transform(fileContent: string, sourceFilePath: string, targetFilePath: string, module: ModuleInfo): Promise<TransformedFile[]> {
    // we should make `npm install` again in target directory to install or remove deps in target directory

    return [
      {
        content: fileContent,
        filename: targetFilePath
      }
    ];
  }
}
