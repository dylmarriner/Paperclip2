import { spawn } from "node:child_process";
import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";

export interface TestEnvironmentResult {
  success: boolean;
  dockerInstalled: boolean;
  dockerRunning: boolean;
  imageAvailable?: boolean;
  error?: string;
}

export async function runWindsurfDockerEnvironmentTest(
  dockerImage = "pfcoperez/windsurfinabox:latest",
): Promise<TestEnvironmentResult> {
  // Check if Docker is installed
  const dockerCheck = await checkCommand("docker", ["--version"]);
  if (!dockerCheck.success) {
    return {
      success: false,
      dockerInstalled: false,
      dockerRunning: false,
      error: dockerCheck.error || "Docker is not installed",
    };
  }

  // Check if Docker is running
  const dockerRunningCheck = await checkCommand("docker", ["info"]);
  if (!dockerRunningCheck.success) {
    return {
      success: false,
      dockerInstalled: true,
      dockerRunning: false,
      error: dockerRunningCheck.error || "Docker is not running",
    };
  }

  // Check if the Windsurf image is available
  const imageCheck = await checkCommand("docker", ["images", dockerImage, "--format", "{{.ID}}"]);
  const imageAvailable = imageCheck.success && imageCheck.output.trim().length > 0;

  return {
    success: true,
    dockerInstalled: true,
    dockerRunning: true,
    imageAvailable,
  };
}

async function checkCommand(
  command: string,
  args: string[],
): Promise<{ success: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    let output = "";
    let errorOutput = "";

    const child = spawn(command, args);

    child.stdout?.on("data", (data) => {
      output += data.toString();
    });

    child.stderr?.on("data", (data) => {
      errorOutput += data.toString();
    });

    child.on("close", (code) => {
      resolve({
        success: code === 0,
        output,
        error: errorOutput || undefined,
      });
    });

    child.on("error", (err) => {
      resolve({
        success: false,
        output,
        error: err.message,
      });
    });
  });
}

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const image =
    typeof ctx.config?.dockerImage === "string" && ctx.config.dockerImage.trim().length > 0
      ? ctx.config.dockerImage.trim()
      : "pfcoperez/windsurfinabox:latest";
  const result = await runWindsurfDockerEnvironmentTest(image);
  const checks: AdapterEnvironmentCheck[] = [];

  checks.push({
    code: "windsurf_docker_installed",
    level: result.dockerInstalled ? "info" : "error",
    message: result.dockerInstalled ? "Docker CLI is installed." : "Docker CLI is not installed.",
    ...(result.dockerInstalled ? {} : { detail: result.error ?? null }),
  });

  if (result.dockerInstalled) {
    checks.push({
      code: "windsurf_docker_running",
      level: result.dockerRunning ? "info" : "error",
      message: result.dockerRunning ? "Docker daemon is running." : "Docker daemon is not running.",
      ...(result.dockerRunning ? {} : { detail: result.error ?? null }),
    });
  }

  if (result.dockerInstalled && result.dockerRunning) {
    checks.push({
      code: "windsurf_docker_image",
      level: result.imageAvailable ? "info" : "warn",
      message: result.imageAvailable
        ? `Docker image is available: ${image}`
        : `Docker image is not present locally: ${image}`,
      ...(result.imageAvailable
        ? {}
        : { hint: `Pull or build the image before running agents, for example: docker pull ${image}` }),
    });
  }

  return {
    adapterType: ctx.adapterType,
    testedAt: new Date().toISOString(),
    checks,
    status: summarizeStatus(checks),
  };
}
