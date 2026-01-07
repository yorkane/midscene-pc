import { sleep } from "@midscene/core/utils";
import { createRemotePCService, PCAgent } from "../src";
import PCDevice from "../src/pc.device";

export async function remoteMonitor() {
  const service = createRemotePCService("http://192.168.1.26:4000");
  const pcDevice = new PCDevice({ pcService: service });
  await pcDevice.launch();
  const pcAgent = new PCAgent(pcDevice);
  await pcAgent.ai("任务管理器");
  const output = await pcAgent.aiOutput(
    "按内存使用排序，找出内存占用率前三的进程，输出详细信息"
  );
  console.log(output);
}
