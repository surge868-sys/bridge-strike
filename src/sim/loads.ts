// The five real 2026 strikes, in date order. Heights are gameplay values (no
// real load heights were published). Names are generic: no brands, companies,
// drivers or outlets.
export interface LoadDef {
  id: number;
  date: string;
  name: string;
  model: string;
  top: number; // top-of-load height above the road, metres
  mass: number; // kg, carried as ballast low on the deck
  where: string;
  briefing: string;
}

export const LOWER_BY = 0.3;
export const DECK_TOP = 0.7; // trailer well-deck height above the road
export const LOAD_Z = -0.74; // centre of the well deck in trailer space

export const LOADS: LoadDef[] = [
  {
    id: 1,
    date: 'Mar 5',
    name: 'Track hoe',
    model: 'load1-trackhoe',
    top: 4.75,
    mass: 22000,
    where: 'Circle Drive at Highway 11',
    briefing: 'Yellow, tracked, boom up. The Highway 16 overpass is posted 4.7. You are 4.75. Do the math, then do the other math.',
  },
  {
    id: 2,
    date: 'Mar 11',
    name: 'Over-height excavator',
    model: 'load2-excavator',
    top: 4.9,
    mass: 32000,
    where: '108th Street',
    briefing: 'The boom does not fold any further. The overpasses do not lift any further. One of you has to give.',
  },
  {
    id: 3,
    date: 'Mar 22',
    name: 'Heavy equipment',
    model: 'load3-loader',
    top: 5.05,
    mass: 18000,
    where: 'CPKC rail bridge and McKercher Drive',
    briefing: 'Two bridges, one afternoon. The railway would like its bridge back in one piece.',
  },
  {
    id: 4,
    date: 'Jul 24',
    name: 'Grain bin',
    model: 'load4-grainbin',
    top: 5.2,
    mass: 3500,
    where: '51st Street',
    briefing: 'It is empty, it is tall, and it has never once wanted to go under anything.',
  },
  {
    id: 5,
    date: 'Sep 2',
    name: 'Twin hopper bins',
    model: 'load5-hoppers',
    top: 5.35,
    mass: 5000,
    where: 'CN rail bridge near the Borden Bridge',
    briefing: 'Two hopper bins, one behind the other. Keep both of them. That is the whole job.',
  },
];
