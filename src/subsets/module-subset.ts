import { LocalModule } from "../local-module";
import * as fs from "fs-extra";
import * as path from "path";


/**
 * Directories that are never included in any subset.
 */
export const KNOWN_IGNORED_DIRS = [
  /node_modules$/,
  /.git$/,
  /.idea$/
];


/**
 * Represents some subset of files in the given module.
 * For example, there can be a subset of files published to npm.
 */
export abstract class ModuleSubset {
  public constructor(protected mod: LocalModule, dirPath?: string) {
    this.dirPath = dirPath == null ? mod.path : dirPath;
  }

  /**
   * Returns `true` if given file is included in subset.
   * Note that is can still return `true` for some files that are never processed by a walker.
   * @param filename
   */
  public abstract async isFileIncluded(filename: string): Promise<boolean>;

  /**
   * Returns unique name of this subset.
   */
  public abstract getName(): string;

  /**
   * Walks all files in this subset.
   * Walker is called with absolute path to a file.
   */
  public async walk(walker: (filename: string, state: fs.Stats) => Promise<void>) {
    const onEntry = async(entry: string) => {
      if (!this.isKnownIgnoredDir(entry)) {
        return;
      }

      if (!this.isFileIncluded(entry)) {
        return;
      }

      let sourceStat: fs.Stats;
      try {
        sourceStat = fs.statSync(entry);
      } catch (error) {
        // we can still get exception here, for example, with broken links, just ignore it
        return;
      }

      if (entry !== this.dirPath) {
        await walker(entry, sourceStat);
      }

      if (sourceStat.isDirectory()) {
        for (let filename of fs.readdirSync(entry)) {
          await onEntry(path.join(entry, filename));
        }
      }
    };

    return onEntry(this.dirPath);
  }

  /**
   * Returns `true` if given file can be included in any subset.
   * We always ignore some directories to avoid traversing them and reduce subset walk time.
   */
  private isKnownIgnoredDir(filePath: string): boolean {
    const filename = path.basename(filePath);
    return !KNOWN_IGNORED_DIRS.some(pattern => pattern.test(filename));
  }

  protected dirPath: string;
}
