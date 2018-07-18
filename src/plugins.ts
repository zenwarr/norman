import {Config, ModuleInfo} from "./config";
import ModuleFetcher from "./fetcher";
import ModuleSynchronizer from "./synchronizer";
import * as path from "path";
import chalk from "chalk";

export interface TransformedFile {
  content: string;
  filename: string;
}

export type IPluginClass = { new(appConfig: Config, fetcher: ModuleFetcher, synchronizer: ModuleSynchronizer): Plugin };

export abstract class Plugin {
  constructor(protected appConfig: Config, protected fetcher: ModuleFetcher, protected synchronizer: ModuleSynchronizer) {

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
    // if package.json of a module has been modified, it can mean that user has installed a new package into it
    if (this.synchronizer.initialSyncDone(module)) {
      console.log(chalk.green(`package.json of [${module.name}] changed, relinking and updating deps...`));

      await this.fetcher.relinkModule(module);

      let conflicts = await this.synchronizer.handleConflicts(module);
      if (conflicts.unresolved.length) {
        this.synchronizer.logConflicts(conflicts.unresolved);
        console.log(`There are conflicts caused by "npm install" for module ${module.npmName.name}, exiting`);
        process.exit(-1);
      }

      if (conflicts.resolved.length) {
        await this.synchronizer.resyncApp();
      }
    }

    return [
      {
        content: fileContent,
        filename: targetFilePath
      }
    ];
  }
}
