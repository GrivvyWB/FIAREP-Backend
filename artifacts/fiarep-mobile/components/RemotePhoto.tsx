import { useEffect, useState } from 'react';
import { Image, type ImageProps } from 'react-native';
import { resolvePhoto, type StoredPhotoRef } from '../lib/photoResolver';

type Props = Omit<ImageProps, 'source'> & {
  localUri: string;
  remote?: StoredPhotoRef;
};

/** Local-first photo viewer shared by all synced-record screens. */
export default function RemotePhoto({ localUri, remote, ...props }: Props) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    resolvePhoto(remote ? { ...remote, localUri } : localUri).then((value) => {
      if (active) setUri(value);
    });
    return () => { active = false; };
  }, [localUri, remote?.objectPath, remote?.contentType]);
  if (!uri) return null;
  return <Image {...props} source={{ uri }} />;
}