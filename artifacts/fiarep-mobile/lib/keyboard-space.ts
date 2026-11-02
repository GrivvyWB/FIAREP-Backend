// While the keyboard is up on iPhone, every screen ends right above it, so lists, results and
// buttons under a text box scroll into view instead of sitting behind the keyboard.
// (Android already resizes the screen for the keyboard.)
import { useEffect, useState } from 'react';
import { Keyboard, LayoutAnimation, Platform, type KeyboardEvent } from 'react-native';

export function useKeyboardSpace(): number {
  const [space, setSpace] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;
    const animate = (e: KeyboardEvent) => {
      if (e.duration) LayoutAnimation.configureNext({ duration: e.duration, update: { type: LayoutAnimation.Types.keyboard } });
    };
    const show = Keyboard.addListener('keyboardWillShow', (e) => { animate(e); setSpace(e.endCoordinates.height); });
    const change = Keyboard.addListener('keyboardWillChangeFrame', (e) => { setSpace(Math.max(0, e.endCoordinates.height)); });
    const hide = Keyboard.addListener('keyboardWillHide', (e) => { animate(e); setSpace(0); });
    return () => { show.remove(); change.remove(); hide.remove(); };
  }, []);
  return space;
}
