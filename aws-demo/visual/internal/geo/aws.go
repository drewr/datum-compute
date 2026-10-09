package geo

// awsLocations places AWS regions on the map. They are named aws-<region> so
// they never collide with a Datum location of the same name (Datum's
// us-east-2 is New York; AWS's is Columbus).
var awsLocations = []Place{
	{Name: "aws-us-east-1", CityCode: "IAD", City: "Ashburn", Country: "United States", CountryCode: "US", Lat: 39.0438, Lon: -77.4874},
	{Name: "aws-us-east-2", CityCode: "CMH", City: "Columbus", Country: "United States", CountryCode: "US", Lat: 39.9612, Lon: -82.9988},
	{Name: "aws-us-west-1", CityCode: "SFO", City: "San Francisco", Country: "United States", CountryCode: "US", Lat: 37.7749, Lon: -122.4194},
	{Name: "aws-us-west-2", CityCode: "PDX", City: "Portland", Country: "United States", CountryCode: "US", Lat: 45.5152, Lon: -122.6784},
	{Name: "aws-ca-central-1", CityCode: "YUL", City: "Montreal", Country: "Canada", CountryCode: "CA", Lat: 45.5017, Lon: -73.5673},
	{Name: "aws-ca-west-1", CityCode: "YYC", City: "Calgary", Country: "Canada", CountryCode: "CA", Lat: 51.0447, Lon: -114.0719},
	{Name: "aws-sa-east-1", CityCode: "GRU", City: "São Paulo", Country: "Brazil", CountryCode: "BR", Lat: -23.5505, Lon: -46.6333},
	{Name: "aws-eu-west-1", CityCode: "DUB", City: "Dublin", Country: "Ireland", CountryCode: "IE", Lat: 53.3498, Lon: -6.2603},
	{Name: "aws-eu-west-2", CityCode: "LHR", City: "London", Country: "United Kingdom", CountryCode: "GB", Lat: 51.5072, Lon: -0.1276},
	{Name: "aws-eu-west-3", CityCode: "CDG", City: "Paris", Country: "France", CountryCode: "FR", Lat: 48.8566, Lon: 2.3522},
	{Name: "aws-eu-central-1", CityCode: "FRA", City: "Frankfurt", Country: "Germany", CountryCode: "DE", Lat: 50.1109, Lon: 8.6821},
	{Name: "aws-eu-central-2", CityCode: "ZRH", City: "Zurich", Country: "Switzerland", CountryCode: "CH", Lat: 47.3769, Lon: 8.5417},
	{Name: "aws-eu-north-1", CityCode: "ARN", City: "Stockholm", Country: "Sweden", CountryCode: "SE", Lat: 59.3293, Lon: 18.0686},
	{Name: "aws-eu-south-1", CityCode: "MXP", City: "Milan", Country: "Italy", CountryCode: "IT", Lat: 45.4642, Lon: 9.19},
	{Name: "aws-eu-south-2", CityCode: "ZAZ", City: "Zaragoza", Country: "Spain", CountryCode: "ES", Lat: 41.6488, Lon: -0.8891},
	{Name: "aws-me-south-1", CityCode: "BAH", City: "Manama", Country: "Bahrain", CountryCode: "BH", Lat: 26.2285, Lon: 50.586},
	{Name: "aws-me-central-1", CityCode: "DXB", City: "Dubai", Country: "United Arab Emirates", CountryCode: "AE", Lat: 25.2048, Lon: 55.2708},
	{Name: "aws-il-central-1", CityCode: "TLV", City: "Tel Aviv", Country: "Israel", CountryCode: "IL", Lat: 32.0853, Lon: 34.7818},
	{Name: "aws-af-south-1", CityCode: "CPT", City: "Cape Town", Country: "South Africa", CountryCode: "ZA", Lat: -33.9249, Lon: 18.4241},
	{Name: "aws-ap-south-1", CityCode: "BOM", City: "Mumbai", Country: "India", CountryCode: "IN", Lat: 19.076, Lon: 72.8777},
	{Name: "aws-ap-south-2", CityCode: "HYD", City: "Hyderabad", Country: "India", CountryCode: "IN", Lat: 17.385, Lon: 78.4867},
	{Name: "aws-ap-southeast-1", CityCode: "SIN", City: "Singapore", Country: "Singapore", CountryCode: "SG", Lat: 1.3521, Lon: 103.8198},
	{Name: "aws-ap-southeast-2", CityCode: "SYD", City: "Sydney", Country: "Australia", CountryCode: "AU", Lat: -33.8688, Lon: 151.2093},
	{Name: "aws-ap-southeast-3", CityCode: "CGK", City: "Jakarta", Country: "Indonesia", CountryCode: "ID", Lat: -6.2088, Lon: 106.8456},
	{Name: "aws-ap-southeast-4", CityCode: "MEL", City: "Melbourne", Country: "Australia", CountryCode: "AU", Lat: -37.8136, Lon: 144.9631},
	{Name: "aws-ap-northeast-1", CityCode: "NRT", City: "Tokyo", Country: "Japan", CountryCode: "JP", Lat: 35.6762, Lon: 139.6503},
	{Name: "aws-ap-northeast-2", CityCode: "ICN", City: "Seoul", Country: "South Korea", CountryCode: "KR", Lat: 37.5665, Lon: 126.978},
	{Name: "aws-ap-northeast-3", CityCode: "KIX", City: "Osaka", Country: "Japan", CountryCode: "JP", Lat: 34.6937, Lon: 135.5023},
	{Name: "aws-ap-east-1", CityCode: "HKG", City: "Hong Kong", Country: "Hong Kong", CountryCode: "HK", Lat: 22.3193, Lon: 114.1694},
}
