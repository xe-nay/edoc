import { Image, type ImageContentFit, type ImageStyle } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp } from 'react-native';

import { loadProtectedImage } from '../actions';
import { pageUri, type DocRef } from '../storage';
import { colors } from '../theme';
import type { Page } from '../types';

type Props = {
  doc: DocRef;
  page: Page;
  // Longest side to decode for protected pages; 0 keeps the full resolution.
  maxDimension?: number;
  contentFit?: ImageContentFit;
  style?: StyleProp<ImageStyle>;
};

// Shows one page. Protected pages are decrypted in memory and never written to disk.
export function PageImage({ doc, page, maxDimension = 0, contentFit = 'contain', style }: Props) {
  const isProtected = Boolean(doc.protected);
  const [decrypted, setDecrypted] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isProtected) {
      return;
    }
    let active = true;
    setDecrypted(null);
    setFailed(false);
    loadProtectedImage({ id: doc.id, protected: true }, page.file, maxDimension)
      .then((uri) => {
        if (active) {
          setDecrypted(uri);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [doc.id, isProtected, page.file, maxDimension]);

  const uri = isProtected ? decrypted : pageUri(doc, page.file);
  if (!uri) {
    return (
      <View style={[style as StyleProp<object>, styles.placeholder]}>
        {failed ? null : <ActivityIndicator color={colors.textFaint} />}
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      cachePolicy={isProtected ? 'none' : 'memory'}
      contentFit={contentFit}
      contentPosition={contentFit === 'cover' ? 'top' : 'center'}
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.navy,
  },
});
