import { ModuleInfo } from "./module-info";
import * as path from "path";


export abstract class FileTransformerPlugin {
  public abstract matches(module: ModuleInfo, filename: string): boolean;

  public abstract async process(module: ModuleInfo, filename: string, fileContent: string): Promise<string>;
}


export class SourceMapPlugin extends FileTransformerPlugin {
  public matches(module: ModuleInfo, filename: string): boolean {
    return filename.endsWith(".js.map");
  }

  public async process(module: ModuleInfo, filename: string, fileContent: string): Promise<string> {
    let json = JSON.parse(fileContent);
    json.sourceRoot = path.dirname(filename);

    return JSON.stringify(json);
  }
}
