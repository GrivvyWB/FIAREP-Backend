import UIKit
import RoomPlan
import ARKit
import ExpoModulesCore

// Uses RoomPlan's built-in RoomCaptureView, which shows Apple's live scanning
// UI (walls/doors/windows highlight in real time as you move the phone) and
// handles capture automatically. Tapping "Done" processes the captured room.
@available(iOS 16.0, *)
class ScanDelegate: NSObject, RoomCaptureViewDelegate, RoomCaptureSessionDelegate {
  private let promise: Promise
  private var vc: UIViewController!
  private var captureView: RoomCaptureView!
  private var finished = false
  private var finalRoom: CapturedRoom?
  private let M_TO_FT = 3.28084

  init(promise: Promise) {
    self.promise = promise
    super.init()
  }

  // RoomCaptureViewDelegate refines NSCoding, so this initializer is required.
  // It is never actually used (we always create the delegate via init(promise:)).
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported for ScanDelegate")
  }

  func encode(with coder: NSCoder) {
    // Not used; ScanDelegate is never archived.
  }

  func present() {
    func topRootVC() -> UIViewController? {
      let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      let windows = scenes.flatMap { $0.windows }
      let base = windows.first(where: { $0.isKeyWindow })?.rootViewController ?? windows.first?.rootViewController
      var top = base
      while let p = top?.presentedViewController { top = p }
      return top
    }
    guard let root = topRootVC() else {
      promise.reject("NO_VC", "Could not find a view controller to present the scanner.")
      return
    }

    vc = UIViewController()
    vc.view.backgroundColor = .black

    // RoomCaptureView provides the live scanning visualization automatically.
    captureView = RoomCaptureView(frame: vc.view.bounds)
    captureView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    captureView.delegate = self
    captureView.captureSession.delegate = self
    vc.view.addSubview(captureView)

    // Instruction banner
    let hint = UILabel()
    hint.text = "Move slowly around the room to scan walls, doors and windows. Tap Done when finished."
    hint.textColor = .white
    hint.font = .systemFont(ofSize: 14, weight: .medium)
    hint.numberOfLines = 0
    hint.textAlignment = .center
    hint.backgroundColor = UIColor(white: 0, alpha: 0.55)
    hint.frame = CGRect(x: 16, y: 110, width: vc.view.bounds.width - 32, height: 60)
    hint.autoresizingMask = [.flexibleWidth, .flexibleBottomMargin]
    hint.layer.cornerRadius = 10
    hint.layer.masksToBounds = true
    vc.view.addSubview(hint)
    // hint fade: show 2s then fade out
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
      UIView.animate(withDuration: 0.6) { hint.alpha = 0 }
    }

    let done = UIButton(type: .system)
    done.setTitle("Done", for: .normal)
    done.setTitleColor(.white, for: .normal)
    done.backgroundColor = UIColor(red: 0.09, green: 0.37, blue: 0.65, alpha: 0.95)
    done.layer.cornerRadius = 10
    done.frame = CGRect(x: vc.view.bounds.width - 96, y: 56, width: 76, height: 40)
    done.autoresizingMask = [.flexibleLeftMargin]
    done.addTarget(self, action: #selector(finish), for: .touchUpInside)
    vc.view.addSubview(done)

    let cancel = UIButton(type: .system)
    cancel.setTitle("Cancel", for: .normal)
    cancel.setTitleColor(.white, for: .normal)
    cancel.backgroundColor = UIColor(white: 0, alpha: 0.6)
    cancel.layer.cornerRadius = 10
    cancel.frame = CGRect(x: 20, y: 56, width: 90, height: 40)
    cancel.addTarget(self, action: #selector(cancelScan), for: .touchUpInside)
    vc.view.addSubview(cancel)

    vc.modalPresentationStyle = .fullScreen
    root.present(vc, animated: true) { [weak self] in
      guard let self = self else { return }
      var cfg = RoomCaptureSession.Configuration()
      self.captureView.captureSession.run(configuration: cfg)
    }
  }

  @objc private func finish() {
    // Stopping the session triggers processing; RoomCaptureViewDelegate then
    // hands us the final CapturedRoom in captureView(_:didPresent:error:).
    captureView.captureSession.stop()
  }

  @objc private func cancelScan() {
    finished = true
    captureView.captureSession.stop()
    DispatchQueue.main.async { [weak self] in
      self?.vc.dismiss(animated: true) { self?.promise.reject("CANCELLED", "Scan cancelled.") }
    }
  }

  // Called by RoomCaptureView after it processes the scan into a final room.
  func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
    // Return true to let RoomCaptureView process and then call didPresent below.
    return true
  }

  func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
    if finished { return }
    finished = true
    if let error = error {
      dismissReject("SCAN_FAILED", error.localizedDescription); return
    }
    NSLog("[RoomScanner] captured walls=%d doors=%d windows=%d", processedResult.walls.count, processedResult.doors.count, processedResult.windows.count)
    let json = buildJSON(from: processedResult)
    DispatchQueue.main.async { [weak self] in
      self?.vc.dismiss(animated: true) { self?.promise.resolve(json) }
    }
  }

  private func dismissReject(_ code: String, _ msg: String) {
    DispatchQueue.main.async { [weak self] in
      self?.vc.dismiss(animated: true) { self?.promise.reject(code, msg) }
    }
  }

  private func r2(_ v: Double) -> Double { (v * 100).rounded() / 100 }

  private func buildJSON(from room: CapturedRoom) -> [String: Any] {
    var wallGross = 0.0
    var maxHgt = 0.0
    for w in room.walls {
      let ftW = Double(w.dimensions.x) * M_TO_FT
      let ftH = Double(w.dimensions.y) * M_TO_FT
      wallGross += ftW * ftH
      maxHgt = max(maxHgt, ftH)
    }
    // Build the wall-outline points first (endpoints of every wall segment),
    // then derive floor area (shoelace) + footprint dims (bounding box).
    var outline: [(x: Double, z: Double)] = []
    for w in room.walls {
      let t = w.transform
      let cx = Double(t.columns.3.x) * M_TO_FT
      let cz = Double(t.columns.3.z) * M_TO_FT
      let dirX = Double(t.columns.0.x)
      let dirZ = Double(t.columns.0.z)
      let halfLen = (Double(w.dimensions.x) * M_TO_FT) / 2.0
      outline.append((cx - dirX * halfLen, cz - dirZ * halfLen))
      outline.append((cx + dirX * halfLen, cz + dirZ * halfLen))
    }
    // bounding box -> overall footprint length x width
    var lengthFt = 0.0, widthFt = 0.0
    if !outline.isEmpty {
      let xs = outline.map { $0.x }, zs = outline.map { $0.z }
      lengthFt = (xs.max()! - xs.min()!)
      widthFt = (zs.max()! - zs.min()!)
      // keep the larger as "length"
      if widthFt > lengthFt { let tmp = lengthFt; lengthFt = widthFt; widthFt = tmp }
    }
    // floor area from the room's captured floor surface if available,
    // else shoelace over the wall-center polygon as an estimate.
    var floorArea = 0.0
    if #available(iOS 17.0, *), let floor = room.floors.first {
      floorArea = Double(floor.dimensions.x) * Double(floor.dimensions.z) * M_TO_FT * M_TO_FT
    }
    if floorArea <= 0 {
      // shoelace over ordered wall centers (approximate room footprint)
      let centers = room.walls.map { w -> (Double, Double) in
        let t = w.transform
        return (Double(t.columns.3.x) * M_TO_FT, Double(t.columns.3.z) * M_TO_FT)
      }
      if centers.count >= 3 {
        var a = 0.0
        for i in 0..<centers.count {
          let j = (i + 1) % centers.count
          a += centers[i].0 * centers[j].1 - centers[j].0 * centers[i].1
        }
        floorArea = abs(a) / 2.0
      }
    }
    // final fallback: bounding-box area
    if floorArea <= 0 { floorArea = lengthFt * widthFt }

    func openings(_ objs: [CapturedRoom.Surface], _ kind: String) -> [[String: Any]] {
      objs.map { o in
        let wFt = Double(o.dimensions.x) * M_TO_FT
        let hFt = Double(o.dimensions.y) * M_TO_FT
        return ["kind": kind, "widthFt": r2(wFt), "heightFt": r2(hFt), "areaSqFt": r2(wFt * hFt)]
      }
    }
    var all = openings(room.windows, "window")
    all += openings(room.doors, "door")
    all += openings(room.openings, "opening")
    let openArea = all.reduce(0.0) { $0 + (($1["areaSqFt"] as? Double) ?? 0) }

    var walls2d: [[String: Double]] = []
    for w in room.walls {
      let t = w.transform
      let cx = Double(t.columns.3.x) * M_TO_FT
      let cz = Double(t.columns.3.z) * M_TO_FT
      var dirX = Double(t.columns.0.x)
      var dirZ = Double(t.columns.0.z)
      let mag = (dirX*dirX + dirZ*dirZ).squareRoot()
      if mag > 1e-6 { dirX /= mag; dirZ /= mag }
      let halfLen = (Double(w.dimensions.x) * M_TO_FT) / 2.0
      NSLog("[ROOMSCAN] wall dimX=%.3fm halfLenFt=%.2f center=(%.2f,%.2f) dir=(%.3f,%.3f)",
            Double(w.dimensions.x), halfLen, cx, cz, dirX, dirZ)
      walls2d.append([
        "x1": r2(cx - dirX * halfLen), "y1": r2(cz - dirZ * halfLen),
        "x2": r2(cx + dirX * halfLen), "y2": r2(cz + dirZ * halfLen),
      ])
    }

    func geo(_ objs: [CapturedRoom.Surface], _ kind: String) -> [[String: Any]] {
      objs.map { o in
        let t = o.transform
        let c0 = t.columns.0, c1 = t.columns.1, c2 = t.columns.2, c3 = t.columns.3
        let matrix: [Double] = [
          Double(c0.x), Double(c0.y), Double(c0.z), Double(c0.w),
          Double(c1.x), Double(c1.y), Double(c1.z), Double(c1.w),
          Double(c2.x), Double(c2.y), Double(c2.z), Double(c2.w),
          Double(c3.x), Double(c3.y), Double(c3.z), Double(c3.w),
        ]
        let wFt: Double = r2(Double(o.dimensions.x) * M_TO_FT)
        let hFt: Double = r2(Double(o.dimensions.y) * M_TO_FT)
        let tFt: Double = r2(Double(o.dimensions.z) * M_TO_FT)
        let dict: [String: Any] = [
          "kind": kind,
          "wFt": wFt,
          "hFt": hFt,
          "tFt": tFt,
          "m": matrix,
        ]
        return dict
      }
    }
    var geometry3d = geo(room.walls, "wall")
    geometry3d += geo(room.doors, "door")
    geometry3d += geo(room.windows, "window")
    geometry3d += geo(room.openings, "opening")

    return [
      "lengthFt": r2(lengthFt), "widthFt": r2(widthFt), "heightFt": r2(maxHgt),
      "floorAreaSqFt": r2(floorArea), "wallGrossSqFt": r2(wallGross),
      "openings": all, "openingAreaSqFt": r2(openArea),
      "wallNetSqFt": r2(max(0, wallGross - openArea)),
      "walls2d": walls2d,
      "geometry3d": geometry3d,
      "confidence": room.walls.count >= 3 ? "high" : "medium",
      "capturedAt": ISO8601DateFormatter().string(from: Date()),
    ]
  }
}
