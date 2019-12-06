import chalk from "chalk";
import { ModuleInfo } from "../module-info";
import { getConfig } from "../config";
import { getDependencyTree, walkDependencyTree } from "../dependency-tree";


export async function dependencyTreeCommand() {
  const config = getConfig();

  console.log(chalk.green("-- BEGIN DEPENDENCY TREE"));

  let tree = getDependencyTree(config.modules);

  let isFirst = true;

  const printTree = (leaf: ModuleInfo, level: number = 0) => {
    let prefix = level === 0 ? (isFirst ? "- " : "\n- ") : " ".repeat(level * 2 + 2);
    console.log(`${ prefix }${ leaf.name }`);

    let root = tree.find(treeLeaf => treeLeaf.module.name === leaf.name);
    if (root) {
      for (let dep of root.dependencies) {
        printTree(dep, level + 1);
      }
    }
  };

  for (let treeRoot of tree) {
    printTree(treeRoot.module);
    isFirst = false;
  }

  console.log(chalk.green("-- END DEPENDENCY TREE"));

  console.log(chalk.green("\n-- BEGIN WALK ORDER"));

  await walkDependencyTree(config.modules, async module => {
    console.log(module.name);
  });

  console.log(chalk.green("-- END WALK ORDER"));
}
