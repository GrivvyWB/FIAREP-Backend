import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Home, HardHat, Building2 } from 'lucide-react';
import { useLocation } from 'wouter';
import { setStoredPersona } from '@/lib/access-policy';

export default function Access() {
  const [, setLocation] = useLocation();

  const handleSelect = (persona: 'resident' | 'vendor' | 'staff') => {
    const chosen = setStoredPersona(persona);
    if (!chosen) return;
    if (chosen === 'staff') {
      setLocation('/login');
    } else {
      setLocation(`/${chosen}`);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md mb-8">
        <div className="flex justify-center">
          <div className="font-bold text-4xl tracking-tight">
            FIA<span className="text-[#F5B301]">REP</span>
          </div>
        </div>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-4xl px-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <button onClick={() => handleSelect('resident')} className="group block focus:outline-none w-full text-left">
            <Card className="h-full hover:border-primary transition-all cursor-pointer hover-elevate shadow-md group-focus:ring-2 group-focus:ring-primary group-focus:ring-offset-2">
              <CardHeader className="text-center py-8">
                <div className="mx-auto bg-primary/10 p-4 rounded-full mb-4 group-hover:bg-primary/20 group-hover:scale-110 transition-all duration-300">
                  <Home className="w-10 h-10 text-primary" />
                </div>
                <CardTitle className="text-xl">Resident</CardTitle>
              </CardHeader>
            </Card>
          </button>

          <button onClick={() => handleSelect('vendor')} className="group block focus:outline-none w-full text-left">
            <Card className="h-full hover:border-primary transition-all cursor-pointer hover-elevate shadow-md group-focus:ring-2 group-focus:ring-primary group-focus:ring-offset-2">
              <CardHeader className="text-center py-8">
                <div className="mx-auto bg-primary/10 p-4 rounded-full mb-4 group-hover:bg-primary/20 group-hover:scale-110 transition-all duration-300">
                  <HardHat className="w-10 h-10 text-primary" />
                </div>
                <CardTitle className="text-xl">Vendor</CardTitle>
              </CardHeader>
            </Card>
          </button>

          <button onClick={() => handleSelect('staff')} className="group block focus:outline-none w-full text-left">
            <Card className="h-full hover:border-primary transition-all cursor-pointer hover-elevate shadow-md group-focus:ring-2 group-focus:ring-primary group-focus:ring-offset-2">
              <CardHeader className="text-center py-8">
                <div className="mx-auto bg-primary/10 p-4 rounded-full mb-4 group-hover:bg-primary/20 group-hover:scale-110 transition-all duration-300">
                  <Building2 className="w-10 h-10 text-primary" />
                </div>
                <CardTitle className="text-xl">Staff</CardTitle>
              </CardHeader>
            </Card>
          </button>
        </div>
      </div>
    </div>
  );
}
