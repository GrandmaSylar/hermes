import { Image } from 'expo-image';
import { View } from 'react-native';

/**
 * The association's emblem as a faint white mark in the corner of a navy card. The card must clip its children
 * (overflow: 'hidden') so the mark is cut by the card's edge, which is what gives it depth.
 */
export function Watermark({ size = 190, opacity = 0.1 }: { size?: number; opacity?: number }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', right: -size * 0.16, bottom: -size * 0.2, width: size, height: size, opacity }}>
      <Image source={require('../../assets/cua-emblem-white.png')} contentFit="contain" style={{ width: size, height: size }} />
    </View>
  );
}

/** The association's full logo (emblem, CUA, name and tagline). Only for light surfaces: it is navy and red. */
export function CuaLogo({ width = 260 }: { width?: number }) {
  return <Image source={require('../../assets/cua-logo.png')} contentFit="contain" accessibilityLabel="Ghana Co-operative Credit Unions Association logo" style={{ width, height: width * 0.7 }} />;
}

/** Just the emblem: the globe, the Ghana map and the two hands. */
export function CuaEmblem({ size = 96 }: { size?: number }) {
  return <Image source={require('../../assets/cua-emblem.png')} contentFit="contain" accessibilityLabel="Credit union emblem" style={{ width: size, height: size }} />;
}
