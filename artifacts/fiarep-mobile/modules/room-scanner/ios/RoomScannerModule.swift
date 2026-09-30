import ExpoModulesCore
import RoomPlan
import ARKit

public class RoomScannerModule: Module {
  private var delegate: ScanDelegate?
  public func definition() -> ModuleDefinition {
    Name("RoomScanner")
    Function("isSupported") { () -> Bool in
      if #available(iOS 16.0, *) { return RoomCaptureSession.isSupported }
      return false
    }
    AsyncFunction("scanRoom") { (promise: Promise) in
      if #available(iOS 16.0, *) {
        guard RoomCaptureSession.isSupported else {
          promise.reject("UNSUPPORTED", "RoomPlan requires a LiDAR device (iPhone/iPad Pro).")
          return
        }
        DispatchQueue.main.async {
          let d = ScanDelegate(promise: promise)
          self.delegate = d
          d.present()
        }
      } else { promise.reject("UNSUPPORTED", "RoomPlan requires iOS 16 or later.") }
    }
  }
}
