import { PCAgent } from "../src";
import PCDevice from "../src/pc.device";
import { localPCService } from "../src/services/local.pc.service";
import { IPCService } from "../src";
import { sleep } from "@midscene/core/utils";

export async function browserUse(pcService: IPCService) {
  const pcDevice = new PCDevice({
    pcService,
    launchOptions: {
      windowInfo: {
        
      },
    },
  });
  await pcDevice.launch();
  const pcAgent = new PCAgent(pcDevice);

  // await pcAgent.aiAction("搜索midscene");
  // await pcAgent.aiAction("找到官网打开");
  await pcAgent.aiKeyboardPress("Win+R");
  await pcAgent.aiInput("msedge","运行")
  await pcAgent.aiKeyboardPress("Enter");
  // await pcAgent.aiKeyboardPress("Ctrl+t");
  await pcAgent.aiAction("地址栏输入: https://chat.baidu.com/ 然后回车");
  await pcAgent.aiAction("点击对话框中的图片按钮(靠近蓝色的向上箭头)");
  await sleep(200);
  await pcAgent.aiAction("点击上传本地图片");
  await sleep(300);
  await pcAgent.aiInput('C:\\Users\\kate\\Pictures\\f1.png', "文件");
  await pcAgent.aiKeyboardPress("Enter");

  // await pcAgent.aiAction(" 发送键盘组合键: 'ALT+O' ");
  await pcAgent.aiAction("在页面内的主对话框中输入'请把女孩换成熊猫'");
  await pcAgent.aiAction("点蓝色的向上按钮");



}
