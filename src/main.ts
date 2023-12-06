import { app, BrowserWindow, Tray, nativeImage, shell } from "electron";
import axios from "axios";
let tray: Tray | null;
let window: BrowserWindow | null = null;

const streamUrl = "http://192.168.13.15:8080/?action=stream";
const snapshotUrl = "http://192.168.13.15:8080/?action=snapshot";

interface PrinterData {
  cameraUrl: string;
  moonrakerAPIUrl: string;
  state: "printing" | "paused" | "standby" | "complete" | "error" | "cancelled";
  heater_bed: any;
  extruder: any;
  virtual_sdcard: any;
  print_stats: any;
  current_file: any;
  gcode_move: any;
  print_estimates?: any;
  actualLayer?: number;
}

const printer: PrinterData = {
  cameraUrl: "http://192.168.13.15:8080",
  moonrakerAPIUrl: "http://192.168.13.15:4408",
  state: "standby",
  heater_bed: {},
  extruder: {},
  virtual_sdcard: {},
  print_stats: {},
  current_file: {},
  gcode_move: {},
};

app.whenReady().then(() => {
  tray = new Tray(nativeImage.createEmpty());

  window = new BrowserWindow({
    width: 320, // Adjust size as needed
    height: 180,
    show: false,
    frame: false,
    fullscreenable: false,
    resizable: false,
    transparent: true,
    webPreferences: {
      // Your webPreferences
    },
  });

  updatePrinterStatus();
  setInterval(updatePrinterStatus, 3000);

  window.loadURL(snapshotUrl);

  window.on("blur", () => {
    if (!window?.webContents.isDevToolsOpened()) {
      window?.hide();
    }
  });

  const getTemperaturesString: () => string = () => {
    return `E:${Math.round(printer.extruder.temperature)}°C, B:${Math.round(
      printer.heater_bed.temperature
    )}°C`;
  };

  async function updateTrayTitle() {
    switch (printer.state) {
      case "printing":
        tray?.setTitle(
          `Printing [${printer.print_estimates.progress}%] L:${printer.actualLayer}/${printer.virtual_sdcard.layer_count} `
        );
        break;
      case "paused":
        tray?.setTitle(
          `Paused ${printer.actualLayer}/${printer.virtual_sdcard.layer_count} ${printer.print_estimates.progress}%`
        );
        break;
      case "standby":
        tray?.setTitle(`Standby ${getTemperaturesString()}`);
        break;
      case "complete":
        tray?.setTitle(`Complete ${getTemperaturesString()}`);
        break;
      case "error":
        tray?.setTitle(`Error`);
        break;
      case "cancelled":
        tray?.setTitle(`Cancelled ${getTemperaturesString()}`);
        break;
    }
  }

  tray?.on("click", () => {
    toggleWindow();
  });

  function toggleWindow(): void {
    if (window?.isVisible()) {
      window.hide();
      pauseStream();
    } else {
      showWindow();
      resumeStream();
    }
  }

  function pauseStream(): void {
    window?.webContents.executeJavaScript(
      `document.querySelector("img").src = "${snapshotUrl}";`,
      true
    );
  }

  async function updatePrinterStatus() {
    await fetchPrinterStatus();
    updateTrayTitle();
  }

  async function fetchPrinterStatus() {
    const response = await axios.get(
      `${printer.moonrakerAPIUrl}/printer/objects/query?heater_bed&extruder&virtual_sdcard&print_stats&gcode_move`
    );
    const data = response.data.result.status;

    printer.state = data.print_stats.state;
    printer.heater_bed = data.heater_bed;
    printer.extruder = data.extruder;
    printer.virtual_sdcard = data.virtual_sdcard;
    printer.print_stats = data.print_stats;
    printer.gcode_move = data.gcode_move;

    const fileResponse = await axios.get(
      `${printer.moonrakerAPIUrl}/server/files/metadata?filename=${printer.print_stats.filename}`
    );

    const fileData = fileResponse.data.result;
    printer.current_file = fileData;

    printer.print_estimates = getTimeEstimates();

    printer.actualLayer = getPrintLayer();
  }

  const getPrintLayer = () => {
    const current_file = printer.current_file;
    const duration = printer.print_stats.print_duration;
    const pos = printer.gcode_move.gcode_position;
    if (
      current_file &&
      duration > 0 &&
      "first_layer_height" in current_file &&
      "layer_height" in current_file &&
      pos &&
      pos.length >= 3
    ) {
      const z = printer.gcode_move.gcode_position[2];
      const l = Math.ceil(
        (z - current_file.first_layer_height) / current_file.layer_height + 1
      );
      if (l > 0) return l;
    }
    return 1;
  };

  const getTimeEstimates = () => {
    const progress = printer.virtual_sdcard.progress
      ? printer.virtual_sdcard.progress
      : 0;
    const timeNow = Math.floor(Date.now() / 1000);
    const duration = printer.print_stats.print_duration
      ? printer.print_stats.print_duration
      : 0;

    let fileEndTime = 0;
    let fileTotalDuration = 0;
    let fileLeft = 0;

    if (progress > 0 && duration > 0) {
      fileTotalDuration = duration / progress;
      fileLeft = fileTotalDuration - duration;
      fileEndTime = timeNow + fileLeft;
    }

    return {
      progress: Math.floor(progress * 100),
      fileEndTime,
      fileTotalDuration,
      fileLeft,
    };
  };

  function resumeStream(): void {
    window?.webContents.executeJavaScript(
      `document.querySelector("img").src = "${streamUrl}";`,
      true
    );
  }

  function showWindow(): void {
    const trayBounds = tray!.getBounds();
    const windowBounds = window!.getBounds();
    const x = Math.round(
      trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2
    );
    let y = Math.round(trayBounds.y + trayBounds.height);

    // Adjust for macOS
    if (process.platform === "darwin") {
      y = Math.round(trayBounds.y);
    }

    window!.setPosition(x, y, false);
    window!.show();
    window!.focus();
  }

  // Double click event
  tray?.on("double-click", () => {
    shell.openExternal(printer.moonrakerAPIUrl);
  });

  // Show state next to the icon (optional)
  tray?.setTitle("Conecting...");

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      // Recreate the window if needed
    }
  });
});