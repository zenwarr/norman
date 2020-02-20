import * as fs from "fs-extra";
import * as path from "path";
import * as utils from "./utils";
import * as os from "os";
import * as ssri from "ssri";
import { ModuleInfo } from "./module-info";
import { PublishDependenciesSubset } from "./publish-dependencies-subset";
import { ServiceLocator } from "./locator";


const TEMP_DIR = path.join(os.tmpdir(), "norman");


/**
 * Creates tarball from module directory.
 * It copies module files into some temp directory and then runs `npm pack` inside to generate tarball.
 */
export class ModulePackager {
  private getVersion(module: ModuleInfo) {
    const manifestContent = fs.readJSONSync(path.join(module.path, "package.json"));
    return encodeURIComponent(manifestContent.version || "unknown");
  }


  private getModuleTempDir(module: ModuleInfo): string {
    return path.join(TEMP_DIR, `${ module.name }-${ this.getVersion(module) }`);
  }


  public getPrepackagedArchivePath(module: ModuleInfo) {
    const tempDir = this.getModuleTempDir(module);

    if (!fs.existsSync(tempDir)) {
      throw new Error(`Failed to find prepackaged archive for module "${ module.name }", maybe version field in package.json changed after running npm install?`);
    }

    const archivePath = this.getTarballPathFromDir(module, tempDir);
    if (!fs.existsSync(archivePath)) {
      throw new Error(`Failed find prepackaged archive for module "${ module.name }", maybe package name in package.json is wrong?`);
    }

    return archivePath;
  }


  public getPrepackagedArchiveIntegrity(module: ModuleInfo): string {
    const tarballPath = this.getPrepackagedArchivePath(module);
    const tarballData = fs.readFileSync(tarballPath);
    return ssri.create().update(tarballData).digest().toString();
  }


  public async pack(module: ModuleInfo): Promise<void> {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirpSync(TEMP_DIR);
    }

    let tempDir = this.getModuleTempDir(module);
    await fs.removeSync(tempDir);

    const subset = new PublishDependenciesSubset();

    await module.walkModuleFiles(async(source, stat) => {
      if (!subset.isFileIncluded(module, source)) {
        return;
      }

      let target = path.join(tempDir, path.relative(module.path, source));

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
      cwd: tempDir,
      silent: true
    });
  }


  private getTarballPathFromDir(module: ModuleInfo, outPath: string): string {
    const version = this.getVersion(module);

    let archiveName: string;
    if (module.npmName.org) {
      archiveName = `${ module.npmName.org }-${ module.npmName.pkg }-${ version }.tgz`;
    } else {
      archiveName = `${ module.npmName.pkg }-${ version }.tgz`;
    }

    return path.join(outPath, archiveName);
  }


  public cleanTemp(): void {
    fs.removeSync(TEMP_DIR);
  }


  public static init() {
    ServiceLocator.instance.initialize("packager", new ModulePackager());
  }
}


export function getPackager() {
  return ServiceLocator.instance.get<ModulePackager>("packager");
}
