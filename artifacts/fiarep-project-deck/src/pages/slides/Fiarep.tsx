import fiarepLogo from "@assets/IMG_5441_1789172478516.PNG";

export default function Fiarep() {
  return (
    <div className="grid-bg relative w-screen h-screen overflow-hidden font-body text-text">
      <div className="absolute left-[5vw] top-[4vh] h-[15vh] w-[28vw] overflow-hidden">
        <img src={fiarepLogo} crossOrigin="anonymous" alt="FIAREP logo" className="h-full w-full object-contain object-left" />
      </div>
      <div className="absolute right-[5vw] top-[5vh] text-right">
        <div className="text-[1.5vw] font-bold uppercase tracking-[0.16em] text-primary">FIAREP</div>
        <div className="mt-[0.6vh] text-[1.5vw] uppercase tracking-[0.12em] text-[#999999]">Project Overview / 2026</div>
      </div>
      <div className="absolute bottom-[9vh] left-[10vw] max-w-[77vw]">
        <div className="mb-[2vh] text-[1.8vw] font-semibold text-primary">Property operations, connected.</div>
        <h1 className="m-0 text-[7vw] font-bold leading-[1.02] tracking-[-0.045em] text-[#111111]">FIAREP</h1>
        <p className="mt-[2vh] max-w-[78vw] text-[2.15vw] font-normal leading-[1.36] text-[#666666] text-wrap-balance">Field Inspection, Assessment, Repair, Estimation &amp; Property Operations Platform</p>
        <p className="mt-[1.3vh] max-w-[78vw] text-[1.7vw] font-normal leading-[1.42] text-[#667085] text-wrap-pretty">One connected system for field teams, management, residents, vendors, Procurement, and platform administration.</p>
      </div>
    </div>
  );
}
