import { runSimulationLab } from "./simulation/runner";

runSimulationLab().catch((error) => {
  console.error("Simulation failed", error);
  process.exitCode = 1;
});
