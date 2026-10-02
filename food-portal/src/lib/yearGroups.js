export const ASSIGNED_YEAR_GROUPS = [
  'Nursery',
  'Reception',
  ...Array.from({ length: 11 }, (_, index) => `Year ${index + 1}`),
]

// Recommendations for the demo only. Stalls not listed stay unset.
export const DEMO_ASSIGNED_YEAR_GROUPS = {
  india: 'Year 1',
  europe: 'Year 3',
  'sri-lanka': 'Year 4',
  china: 'Year 6',
  'usa-canada': 'Year 8',
  'singapore-malaysia-thailand': 'Year 9',
  japan: 'Year 11',
  'middle-east': 'Reception',
}
