import start from "./src/norman";
import chalk from "chalk";

start().then(() => {

}, (error: Error) => {
  console.log(chalk.red(`Error: ${error.message}`));
  console.error(error);
});
