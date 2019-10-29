import { ModuleInfo } from "./module-info";
import * as path from "path";


export abstract class FileTransformerPlugin {
  public abstract matches(module: ModuleInfo, filename: string): boolean;

  public abstract async process(module: ModuleInfo, filename: string, fileContent: Buffer): Promise<Buffer>;
}


export class SourceMapPlugin extends FileTransformerPlugin {
  public matches(module: ModuleInfo, filename: string): boolean {
    return filename.endsWith(".js.map");
  }

  public async process(module: ModuleInfo, filename: string, fileContent: Buffer): Promise<Buffer> {
    let textContent = fileContent.toString("utf-8");

    let json = JSON.parse(textContent);
    json.sourceRoot = path.dirname(filename);

    return Buffer.from(JSON.stringify(json), "utf-8");
  }
}
