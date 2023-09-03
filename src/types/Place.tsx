import { UnsignedEvent } from 'nostr-tools'
import { Event } from 'nostr-tools'

export enum Kind {
  Place = 37515,
}

export type DraftPlace = {
  kind: 37515,
  tags: string[][],
  content: PlaceProperties,
}

export type Place = {
  kind: 37515,
  tags: string[][],
  content: PlaceProperties,
  created_at: number,
  pubkey: string,
  id: string,
  sig: string,
}

export type EventWithoutContent = Omit<Event<37515>, 'content'>

export type PlaceProperties = {
  type: "Feature",
  geometry: {
    coordinates: [number, number],
    type: "Point"
  },
  properties: {
    name: string,
    abbrev?: string,
    description: string,
    address?: PlaceAddress,
    type: GooglePlaceType,
    status?: GooglePlaceStatus,
    website?: string,
    phone?: string,
    hours?: string,
    // string index
    [key: string]: string | object | undefined
  }
}

export type PlaceAddress = {
  "street-address"?: string,
  locality?: string, // city
  region?: string, // state
  "country-name"?: string,
  "postal-code"?: string,
}

export type AddressKeys = keyof PlaceAddress

export type DraftPlaceProviderProps = {
  children: React.ReactNode
};
export type DraftPlaceContextType = {
  draftPlace: DraftPlace
  setDraftPlace: (draftPlace: DraftPlace) => void
};

// this is used in code to validate properties
export const requiredProperties = [
  'name',
  'description',
  'type',
]

// create a type for a version of DraftPlace that can be signed and broadcast
export type SignableDraftPlace<K extends number = Kind> = UnsignedEvent<K>

export type GooglePlaceStatus = 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY' | 'OPERATIONAL'

export type GooglePlaceType = 'accounting' | 'airport' | 'amusement_park' | 'aquarium' | 'art_gallery' | 'atm' | 'bakery' | 'bank' | 'bar' | 'beauty_salon' | 'bicycle_store' | 'book_store' | 'bowling_alley' | 'bus_station' | 'cafe' | 'campground' | 'car_dealer' | 'car_rental' | 'car_repair' | 'car_wash' | 'casino' | 'cemetery' | 'church' | 'city_hall' | 'clothing_store' | 'convenience_store' | 'courthouse' | 'dentist' | 'department_store' | 'doctor' | 'drugstore' | 'electrician' | 'electronics_store' | 'embassy' | 'fire_station' | 'florist' | 'funeral_home' | 'furniture_store' | 'gas_station' | 'gym' | 'hair_care' | 'hardware_store' | 'hindu_temple' | 'home_goods_store' | 'hospital' | 'insurance_agency' | 'jewelry_store' | 'laundry' | 'lawyer' | 'library' | 'light_rail_station' | 'liquor_store' | 'local_government_office' | 'locksmith' | 'lodging' | 'meal_delivery' | 'meal_takeaway' | 'mosque' | 'movie_rental' | 'movie_theater' | 'moving_company' | 'museum' | 'night_club' | 'painter' | 'park' | 'parking' | 'pet_store' | 'pharmacy' | 'physiotherapist' | 'plumber' | 'police' | 'post_office' | 'primary_school' | 'real_estate_agency' | 'restaurant' | 'roofing_contractor' | 'rv_park' | 'school' | 'secondary_school' | 'shoe_store' | 'shopping_mall' | 'spa' | 'stadium' | 'storage' | 'store' | 'subway_station' | 'supermarket' | 'synagogue' | 'taxi_stand' | 'tourist_attraction' | 'train_station' | 'transit_station' | 'travel_agency' | 'university' | 'veterinary_care' | 'zoo' | 'administrative_area_level_1' | 'administrative_area_level_2' | 'administrative_area_level_3' | 'administrative_area_level_4' | 'administrative_area_level_5' | 'administrative_area_level_6' | 'administrative_area_level_7' | 'archipelago' | 'colloquial_area' | 'continent' | 'country' | 'establishment' | 'finance' | 'floor' | 'food' | 'general_contractor' | 'geocode' | 'health' | 'intersection' | 'landmark' | 'locality' | 'natural_feature' | 'neighborhood' | 'place_of_worship' | 'plus_code' | 'point_of_interest' | 'political' | 'post_box' | 'postal_code' | 'postal_code_prefix' | 'postal_code_suffix' | 'postal_town' | 'premise' | 'room' | 'route' | 'street_address' | 'street_number' | 'sublocality' | 'sublocality_level_1' | 'sublocality_level_2' | 'sublocality_level_3' | 'sublocality_level_4' | 'sublocality_level_5' | 'subpremise' | 'town_square'

export const typeDropdown = ( ref: React.RefObject<HTMLSelectElement>, defaultValue: string, update: () => void ) => {
  return (
    <select id="type" ref={ref} defaultValue={defaultValue} onChange={() => update()}>
      <option value="accounting">Accounting</option>
      <option value="administrative_area_level_1">Administrative Area Level 1</option>
      <option value="administrative_area_level_2">Administrative Area Level 2</option>
      <option value="administrative_area_level_3">Administrative Area Level 3</option>
      <option value="administrative_area_level_4">Administrative Area Level 4</option>
      <option value="administrative_area_level_5">Administrative Area Level 5</option>
      <option value="administrative_area_level_6">Administrative Area Level 6</option>
      <option value="administrative_area_level_7">Administrative Area Level 7</option>
      <option value="airport">Airport</option>
      <option value="amusement_park">Amusement Park</option>
      <option value="aquarium">Aquarium</option>
      <option value="archipelago">Archipelago</option>
      <option value="art_gallery">Art Gallery</option>
      <option value="atm">ATM</option>
      <option value="bakery">Bakery</option>
      <option value="bank">Bank</option>
      <option value="bar">Bar</option>
      <option value="beauty_salon">Beauty Salon</option>
      <option value="bicycle_store">Bicycle Store</option>
      <option value="book_store">Book Store</option>
      <option value="bowling_alley">Bowling Alley</option>
      <option value="bus_station">Bus Station</option>
      <option value="cafe">Cafe</option>
      <option value="campground">Campground</option>
      <option value="car_dealer">Car Dealer</option>
      <option value="car_rental">Car Rental</option>
      <option value="car_repair">Car Repair</option>
      <option value="car_wash">Car Wash</option>
      <option value="casino">Casino</option>
      <option value="cemetery">Cemetery</option>
      <option value="church">Church</option>
      <option value="city_hall">City Hall</option>
      <option value="clothing_store">Clothing Store</option>
      <option value="colloquial_area">Colloquial Area</option>
      <option value="continent">Continent</option>
      <option value="convenience_store">Convenience Store</option>
      <option value="country">Country</option>
      <option value="courthouse">Courthouse</option>
      <option value="dentist">Dentist</option>
      <option value="department_store">Department Store</option>
      <option value="doctor">Doctor</option>
      <option value="drugstore">Drugstore</option>
      <option value="electrician">Electrician</option>
      <option value="electronics_store">Electronics Store</option>
      <option value="embassy">Embassy</option>
      <option value="establishment">Establishment</option>
      <option value="finance">Finance</option>
      <option value="fire_station">Fire Station</option>
      <option value="floor">Floor</option>
      <option value="florist">Florist</option>
      <option value="food">Food</option>
      <option value="funeral_home">Funeral Home</option>
      <option value="furniture_store">Furniture Store</option>
      <option value="gas_station">Gas Station</option>
      <option value="general_contractor">General Contractor</option>
      <option value="geocode">Geocode</option>
      <option value="gym">Gym</option>
      <option value="hair_care">Hair Care</option>
      <option value="hardware_store">Hardware Store</option>
      <option value="health">Health</option>
      <option value="hindu_temple">Hindu Temple</option>
      <option value="home_goods_store">Home Goods Store</option>
      <option value="hospital">Hospital</option>
      <option value="insurance_agency">Insurance Agency</option>
      <option value="intersection">Intersection</option>
      <option value="jewelry_store">Jewelry Store</option>
      <option value="landmark">Landmark</option>
      <option value="laundry">Laundry</option>
      <option value="lawyer">Lawyer</option>
      <option value="library">Library</option>
      <option value="light_rail_station">Light Rail Station</option>
      <option value="liquor_store">Liquor Store</option>
      <option value="local_government_office">Local Government Office</option>
      <option value="locality">Locality</option>
      <option value="locksmith">Locksmith</option>
      <option value="lodging">Lodging</option>
      <option value="meal_delivery">Meal Delivery</option>
      <option value="meal_takeaway">Meal Takeaway</option>
      <option value="mosque">Mosque</option>
      <option value="movie_rental">Movie Rental</option>
      <option value="movie_theater">Movie Theater</option>
      <option value="moving_company">Moving Company</option>
      <option value="museum">Museum</option>
      <option value="natural_feature">Natural Feature</option>
      <option value="neighborhood">Neighborhood</option>
      <option value="night_club">Night Club</option>
      <option value="painter">Painter</option>
      <option value="park">Park</option>
      <option value="parking">Parking</option>
      <option value="pet_store">Pet Store</option>
      <option value="pharmacy">Pharmacy</option>
      <option value="physiotherapist">Physiotherapist</option>
      <option value="place_of_worship">Place of Worship</option>
      <option value="plumber">Plumber</option>
      <option value="plus_code">Plus Code</option>
      <option value="point_of_interest">Point of Interest</option>
      <option value="police">Police</option>
      <option value="political">Political</option>
      <option value="post_box">Post Box</option>
      <option value="post_office">Post Office</option>
      <option value="postal_code_prefix">Postal Code Prefix</option>
      <option value="postal_code_suffix">Postal Code Suffix</option>
      <option value="postal_code">Postal Code</option>
      <option value="postal_town">Postal Town</option>
      <option value="premise">Premise</option>
      <option value="primary_school">Primary School</option>
      <option value="real_estate_agency">Real Estate Agency</option>
      <option value="restaurant">Restaurant</option>
      <option value="roofing_contractor">Roofing Contractor</option>
      <option value="room">Room</option>
      <option value="route">Route</option>
      <option value="rv_park">RV Park</option>
      <option value="school">School</option>
      <option value="secondary_school">Secondary School</option>
      <option value="shoe_store">Shoe Store</option>
      <option value="shopping_mall">Shopping Mall</option>
      <option value="spa">Spa</option>
      <option value="stadium">Stadium</option>
      <option value="storage">Storage</option>
      <option value="store">Store</option>
      <option value="street_address">Street Address</option>
      <option value="street_number">Street Number</option>
      <option value="sublocality_level_1">Sublocality Level 1</option>
      <option value="sublocality_level_2">Sublocality Level 2</option>
      <option value="sublocality_level_3">Sublocality Level 3</option>
      <option value="sublocality_level_4">Sublocality Level 4</option>
      <option value="sublocality_level_5">Sublocality Level 5</option>
      <option value="sublocality">Sublocality</option>
      <option value="subpremise">Subpremise</option>
      <option value="subway_station">Subway Station</option>
      <option value="supermarket">Supermarket</option>
      <option value="synagogue">Synagogue</option>
      <option value="taxi_stand">Taxi Stand</option>
      <option value="tourist_attraction">Tourist Attraction</option>
      <option value="town_square">Town Square</option>
      <option value="train_station">Train Station</option>
      <option value="transit_station">Transit Station</option>
      <option value="travel_agency">Travel Agency</option>
      <option value="university">University</option>
      <option value="veterinary_care">Veterinary Care</option>
      <option value="zoo">Zoo</option>
    </select>
  )
}