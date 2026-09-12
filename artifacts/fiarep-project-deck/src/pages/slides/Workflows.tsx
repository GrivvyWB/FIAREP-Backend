export default function Workflows() {
  return (
    <div className="grid-bg relative w-screen h-screen overflow-hidden font-body text-text">
      <div className="absolute left-[5vw] top-[5vh] h-[3vw] w-[3vw] bg-primary" />
      <div className="absolute right-[5vw] top-[5vh] text-right text-[1.5vw] font-semibold uppercase tracking-[0.12em] text-primary">FIAREP / 04</div>
      <div className="absolute left-[8vw] top-[13vh] w-[84vw]">
        <h2 className="max-w-[80vw] text-[4vw] font-bold leading-[1.08] tracking-[-0.035em] text-[#111111]">Controlled workflows from intake to completion</h2>
        <div className="mt-[3.5vh] border-y-2 border-primary bg-[#FCFCFB]/95 px-[2vw] py-[2.3vh]">
          <div className="flex items-center justify-between text-[1.65vw] font-bold text-primary">
            <span>CPM</span><span className="text-[#98A2B3]">→</span><span>Management review</span><span className="text-[#98A2B3]">→</span><span>Procurement release</span><span className="text-[#98A2B3]">→</span><span>Vendor bids</span><span className="text-[#98A2B3]">→</span><span>Award or close</span>
          </div>
          <p className="mt-[1.5vh] text-[1.5vw] text-[#667085]">Procurement: CPM → Management review → Procurement release → Vendor bids → award or close</p>
        </div>
        <div className="mt-[3.4vh] grid grid-cols-3 gap-[2vw]">
          <div className="border border-[#DDE2E7] bg-[#FCFCFB]/95 p-[2vw]">
            <div className="mb-[1.2vh] text-[1.5vw] font-bold uppercase tracking-[0.1em] text-primary">Resident complaints</div>
            <p className="text-[2vw] font-medium leading-[1.36] text-[#334155]">Resident complaints: address-based routing, persistent alerts, assignment, work, and resolution</p>
          </div>
          <div className="border border-[#DDE2E7] bg-[#FCFCFB]/95 p-[2vw]">
            <div className="mb-[1.2vh] text-[1.5vw] font-bold uppercase tracking-[0.1em] text-primary">Field operations</div>
            <p className="text-[2vw] font-medium leading-[1.36] text-[#334155]">Field operations: offline-capable records, synchronized updates, inspections, estimates, uploads, and AI-assisted classification</p>
          </div>
          <div className="border border-[#DDE2E7] bg-[#FCFCFB]/95 p-[2vw]">
            <div className="mb-[1.2vh] text-[1.5vw] font-bold uppercase tracking-[0.1em] text-primary">Authority</div>
            <p className="text-[2vw] font-medium leading-[1.36] text-[#334155]">Authority: Borough Director operational oversight with Procurement kept separate from ordinary management access</p>
          </div>
        </div>
      </div>
    </div>
  );
}
