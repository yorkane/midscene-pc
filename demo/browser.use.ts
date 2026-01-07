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
        appName: "Edge"
      },
    },
  });
  await pcDevice.launch();
  const pcAgent = new PCAgent(pcDevice,{
    generateReport: false,
    autoPrintReportMsg: true
  });

  // await pcAgent.aiKeyboardPress("Win+R");
  // await pcAgent.aiInput("msedge","运行")
  // await pcAgent.aiKeyboardPress("Enter");
  // await pcAgent.aiKeyboardPress("Ctrl+t");
  
  // await pcAgent.aiAction("地址栏输入: https://labs.google/fx/tools/flow/project/8dd959f0-c9c5-4b7f-82c2-c67cf94384e3 然后回车");
  // await pcAgent.aiAction("点击对话框中的 'Text to Video' 按钮");
  // await sleep(50);
  // await pcAgent.aiTap('Create Image');

  for (let index = 0; index < 5; index++) {
  await pcAgent.aiKeyboardPress("F5");
  await sleep(2000)
  // await pcAgent.aiKeyboardPress("Esc");
  // await pcAgent.aiScroll({ scrollType: "untilTop",direction: "up"});
  // await pcAgent.aiTap('底部对话框上部的  tune 按钮 ');
  // await pcAgent.aiTap('Outputs per prompt');
  // await pcAgent.aiTap('下拉菜单 2');
await pcAgent.aiTap('[nano Banana Pro] 下面的输入框');
// await pcAgent.aiAction("")
  // await pcAgent.aiAction("清除底部 [nano Banana Pro] 下面的输入框中的文字， 在输入框内输入 '选择《射雕英雄传》中的一个场景,输出这个场景的9宫格画面，保持人物和场景的一致性，史诗电影风格， 不要有字幕和说明', 然后回车");
  await pcAgent.aiAction("清除输入框中的文字， 然后内输入 '选择《射雕英雄传》中的一个场景,输出这个场景的9宫格画面，保持人物和场景的一致性，新海诚动画风格， 不要有字幕和说明', 然后回车");
  await sleep(20000)
  // await pcAgent.aiKeyboardPress("F5");
    await pcAgent.aiWaitFor("等待的黑色背景变成图片", {
    checkIntervalMs: 2000,
    timeoutMs: 20000
  });

  await pcAgent.aiHover("顶部左图中的左半边")
  // await pcAgent.aiAction("鼠标悬浮在页面上部左侧图片，出现了 喜欢 下载 ... 三个图标，点击下载图标")
  await pcAgent.aiTap("图片中 心形 图标右侧的 Download 图标")
  await pcAgent.aiTap("Download 4K");
  // await pcAgent.aiKeyboardPress("Esc");
  await pcAgent.aiHover("顶部右图中的右半边")
  await pcAgent.aiTap("图片中 心形 图标右侧的 Download 图标")
  await pcAgent.aiTap("Download 4K");
  await sleep(5000)
  //  await pcAgent.aiWaitFor("等待的右上角出现 'Upscaling complete, your image has been downloaded!'", {
  //   checkIntervalMs: 2000,
  //   timeoutMs: 20000
  // });
  // await pcAgent.aiKeyboardPress("Esc");
  // sleep(3000)
  // await pcAgent.aiAction("点击网页右上角紫色的 'Dismiss' 文字，直到 'Dismiss' 消失");
  // await pcAgent.aiScroll({ scrollType: "once", direction: 'down', distance: 300 });
  // await pcAgent.aiHover("底部图片中的左半边")
  // await pcAgent.aiTap("图片中右侧的悬浮 Download 小图标")
  // await pcAgent.aiTap("Download 4K")
  // // await pcAgent.aiKeyboardPress("Esc");
  // await pcAgent.aiHover("底部图中的右半边")
  // await pcAgent.aiTap("图片中右侧的悬浮 Download 小图标")
  // await pcAgent.aiTap("Download 4K")
  // // await pcAgent.aiKeyboardPress("Esc");
  // await pcAgent.aiScroll({ scrollType: "untilTop",direction: "up"});

  }
}

