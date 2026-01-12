import { PCAgent } from "../src";
import PCDevice from "../src/pc.device";
import { localPCService } from "../src/services/local.pc.service";
import { IPCService } from "../src";
import { sleep } from "@midscene/core/utils";

export async function weixin(pcService: IPCService) {
  const pcDevice = new PCDevice({
    pcService,
    launchOptions: {
      windowInfo: {
        appName: "Weixin",
        title: "微信",
      },
    },
  });
  const video = new PCDevice({
    pcService,
    launchOptions: {
      windowInfo: {
        appName: "WeChatAppEx",
      },
    },
  });
  const mainW = new PCDevice({
    pcService,
    launchOptions: {
      screenArea: {
        preferManual: false, // 启动手动绘制模式。如果不传参数，默认primary显示器，也可以传递显示器的id、截图区域等，具体可以参考代码实现
      },
    },
  });
  await pcDevice.launch();
  await mainW.launch();
  const pcAgent = new PCAgent(pcDevice, {
    generateReport: false,
    autoPrintReportMsg: true
  });


  const win = new PCAgent(mainW, {
    generateReport: false,
    autoPrintReportMsg: true
  });

  // await pcAgent.aiKeyboardPress("Win+R");
  // await pcAgent.aiInput("msedge","运行")
  // await pcAgent.aiKeyboardPress("Enter");
  // await pcAgent.aiKeyboardPress("Ctrl+t");
  // await win.aiTap("左半边屏幕中的笑脸按钮")
  const msgData = await pcAgent.aiQuery({
    url: '可能存在的https地址: string',
    isVideo: '是否是可以播放的视频消息: bool',
    picTitle: '消息头部和中部的文字: string',
    author: '消息中底部的白色文字: string',
  })
  console.dir(msgData)

  await pcAgent.aiDoubleClick("视频消息的播放按钮");
  await sleep(2000)
  // await pcAgent2.aiTap('window center');
  // await pcAgent2.aiKeyboardPress('Ctrl+W');
  const videoPlaying = await win.aiBoolean('有一个包含`视频号`标题的窗口')
  if(videoPlaying) {
      await video.launch();
      const vWin = new PCAgent(video, {
        generateReport: false,
        autoPrintReportMsg: true
      });
    await vWin.aiTap("视频号 tab")
    await vWin.aiKeyboardPress("Alt+F4")
    // await vWin.aiTap("窗口右上角的关闭按钮")
    // win.aiKeyboardPress("Alt+F4")
      // await win.aiTap('`视频号`视频窗口右上角的关闭按钮')
        // await win.aiTap("视频号 窗口右上角的关闭按钮")
  }

  // await resAgent.aiTap()
  // await pcAgent2('')

  // await pcAgent.aiAction("点击对话框中的 'Text to Video' 按钮");
  // await sleep(50);

  // await pcAgent.aiKeyboardPress("Esc");
  // await pcAgent.aiScroll({ scrollType: "untilTop",direction: "up"});
  // await pcAgent.aiTap('底部对话框上部的  tune 按钮 ');
  // await pcAgent.aiTap('Outputs per prompt');
  // await pcAgent.aiTap('下拉菜单 2');
  // await pcAgent.aiTap('[nano Banana Pro] 下面的输入框');
  // await pcAgent.aiAction("")
  // await pcAgent.aiAction("清除底部 [nano Banana Pro] 下面的输入框中的文字， 在输入框内输入 '选择《射雕英雄传》中的一个场景,输出这个场景的9宫格画面，保持人物和场景的一致性，史诗电影风格， 不要有字幕和说明', 然后回车");
  // await pcAgent.aiAction("清除输入框中的文字， 然后内输入 '选择《射雕英雄传》中的一个场景,输出这个场景的9宫格画面，保持人物和场景的一致性，史诗电影风格， 不要有字幕和说明', 然后回车");

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
}

