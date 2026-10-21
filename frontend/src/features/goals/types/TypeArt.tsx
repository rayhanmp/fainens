import { EducationArt } from './art/EducationArt';
import { EmergencyArt } from './art/EmergencyArt';
import { GadgetArt } from './art/GadgetArt';
import { HouseArt } from './art/HouseArt';
import { UmrahArt } from './art/UmrahArt';
import { WeddingArt } from './art/WeddingArt';
import { YearlyArt } from './art/YearlyArt';

/** A goal's picture for its kind, beside its top card; nothing for a plain goal or a holiday, which has its own. */
export function TypeArt({ goalType, color, fill }: { goalType: string | null; color: string; fill: number }) {
  switch (goalType) {
    case 'emergency': return <EmergencyArt color={color} fill={fill} />;
    case 'house': return <HouseArt color={color} fill={fill} />;
    case 'wedding': return <WeddingArt color={color} fill={fill} />;
    case 'umrah': return <UmrahArt color={color} fill={fill} />;
    case 'education': return <EducationArt color={color} fill={fill} />;
    case 'gadget': return <GadgetArt color={color} fill={fill} />;
    case 'vehicle-tax':
    case 'insurance':
    case 'lebaran': return <YearlyArt variant={goalType} color={color} fill={fill} />;
    default: return null;
  }
}
