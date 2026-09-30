import ExpoModulesCore
import ARKit

public class ARMeasureModule: Module {
  private var delegate: ARMeasureDelegate?
  private var autoDelegate: ARAutoScanDelegate?
  public func definition() -> ModuleDefinition {
    Name("ARMeasure")
    Function("isSupported") { () -> Bool in
      return ARWorldTrackingConfiguration.isSupported
    }
    AsyncFunction("measure") { (steps: [String]?, promise: Promise) in
      guard ARWorldTrackingConfiguration.isSupported else {
        promise.reject("UNSUPPORTED", "AR measuring requires an ARKit-capable device.")
        return
      }
      DispatchQueue.main.async {
        let d = ARMeasureDelegate(promise: promise, steps: steps ?? [])
        self.delegate = d
        d.present()
      }
    }
    // Automatic: finds the door / window frame in the camera view and measures
    // it without any tapping.
    AsyncFunction("scanOpening") { (mode: String?, label: String?, promise: Promise) in
      guard ARWorldTrackingConfiguration.isSupported else {
        promise.reject("UNSUPPORTED", "AR scanning requires an ARKit-capable device.")
        return
      }
      DispatchQueue.main.async {
        let d = ARAutoScanDelegate(promise: promise, mode: mode ?? "opening", label: label ?? "opening")
        self.autoDelegate = d
        d.present()
      }
    }
  }
}
