import * as child_process from "child_process";
import chalk from "chalk";


export function runCommand(command: string, args: string[], options?: child_process.SpawnOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    console.log(chalk.cyan(`→ ${command} ${args.join(" ")}`));

    let proc = child_process.spawn(command, args, Object.assign({
      stdio: "inherit"
    }, options || { }));

    proc.on("close", code => {
      console.log(chalk.cyan("→ DONE"));
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });

    proc.on("error", error => {
      console.log(chalk.red(`→ ERROR: ${error.message}`));
      reject(error);
    });
  });
}
