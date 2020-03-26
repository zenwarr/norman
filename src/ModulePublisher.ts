import { ServiceLocator } from "./locator";
import { LocalModule } from "./local-module";
import * as fs from "fs-extra";
import { PublishDependenciesSubset } from "./subsets/publish-dependencies-subset";
import * as path from "path";
import * as utils from "./utils";
import * as os from "os";
import * as ssri from "ssri";


const TEMP_DIR = path.join(os.tmpdir(), "norman");


export class ModulePublisher {
  public getTarballPath(module: LocalModule): string {
    const publishDir = this.getModulePublishDir(module);
    return this.getTarballPathFromDir(module, publishDir);
  }


  public getPublishedTarballIntegrity(module: LocalModule): string {
    const tarballPath = this.getTarballPath(module);
    try {
      const tarballData = fs.readFileSync(tarballPath);
      return ssri.create().update(tarballData).digest().toString();
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`Local module "${ module.checkedName.name }" is not published to norman`);
      } else {
        throw error;
      }
    }
  }


  public getPublishedPackageJSON(module: LocalModule): any {
    const publishDir = this.getModulePublishDir(module);
    try {
      return fs.readJSONSync(path.join(publishDir, "package.json"));
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`Local module "${ module.checkedName.name }" is not published to norman`);
      } else {
        throw error;
      }
    }
  }


  public async publish(module: LocalModule): Promise<void> {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirpSync(TEMP_DIR);
    }

    let publishDir = this.getModulePublishDir(module);
    await fs.removeSync(publishDir);

    const subset = new PublishDependenciesSubset(module);
    await subset.walk(async (source, stat) => {
      let target = path.join(publishDir, path.relative(module.path, source));

      let parentDestDir = path.dirname(target);
      if (!fs.existsSync(parentDestDir)) {
        fs.mkdirpSync(parentDestDir);
      }

      if (!stat.isDirectory()) {
        await module.copyFile(source, target);
      } else {
        fs.mkdirpSync(target);
      }
    });

    await utils.runCommand(utils.getNpmExecutable(), [ "pack" ], {
      cwd: publishDir,
      silent: true
    });
  }


  private getModulePublishDir(module: LocalModule): string {
    return path.join(TEMP_DIR, `norman-publish-${ module.name }`);
  }


  private getVersion(module: LocalModule) {
    const manifestContent = fs.readJSONSync(path.join(module.path, "package.json"));
    if (!manifestContent.version) {
      throw new Error(`No version defined in package.json of module "${ module.checkedName.name }"`);
    }

    return encodeURIComponent(manifestContent.version);
  }


  private getTarballPathFromDir(module: LocalModule, outPath: string): string {
    const version = this.getVersion(module);

    if (!module.name) {
      throw new Error(`No package name defined in package.json of module "${ module.checkedName.name }"`);
    }

    let archiveName: string;
    if (module.name.scope) {
      archiveName = `${ module.name.scope }-${ module.name.pkg }-${ version }.tgz`;
    } else {
      archiveName = `${ module.name.pkg }-${ version }.tgz`;
    }

    return path.join(outPath, archiveName);
  }


  public cleanTemp(): void {
    fs.removeSync(TEMP_DIR);
  }


  public static init() {
    ServiceLocator.instance.initialize("publisher", new ModulePublisher());
  }
}


export function getPublisher() {
  return ServiceLocator.instance.get<ModulePublisher>("publisher");
}
