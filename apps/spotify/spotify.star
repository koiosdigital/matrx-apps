load("render.star", "render")
load("encoding/base64.star", "base64")
load("encoding/json.star", "json")
load("cache.star", "cache")
load("http.star", "http")
load("schema.star", "schema")
load("time.star", "time")
load("hash.star", "hash")
load("secret.star", "secret")

SPOTIFY_CLIENT_ID = "a690455837b6449490df45d115b2dff6"
SPOTIFY_CLIENT_SECRET = secret.decrypt("AcFxL1ps3ZMPOAQ5OgVWwufZA5haYo4aHmk/TB88Psmtv1XdE7WN0awHevvZuo+dyaTRRkfK06EqVwiZK+pfP3EnL+LFFzzEvmHNvKZxc/YprPPDiw==")

def primaryText(text):
    return render.Padding(pad=(2,0,0,0), child=render.Marquee(
        width=60,
        child=render.Padding(pad=(0,2,0,0), child=render.Text(text.upper(), color="#1db954")),
    ))
    
def detailText(text):
    return render.Marquee(
        width=41,
        child=render.Text(text.upper()),
    )

def errorView(message):
    return render.WrappedText(
        content=message,
        width=64,
        color="#fff",
    )

def main(config):
    currently_playing = get_currently_playing(config)

    track_title = currently_playing["item"]["name"]
    track_image = http.get(currently_playing["item"]["album"]["images"][0]["url"], ttl_seconds=86400).body()

    artist = currently_playing["item"]["artists"][0]["name"]
    album = currently_playing["item"]["album"]["name"]

    return render.Root(
        child=render.Column(children=[
            primaryText(track_title),
            render.Padding(pad=(2,2,0,0), child=
                render.Row(children=[
                    render.Image(src=track_image, height=17, width=17),
                    render.Padding(pad=(2,0,0,0), child=
                        render.Column(children=[
                            detailText(artist),
                            render.Padding(pad=(0,1,0,0), child=detailText(album))
                        ])
                    )
                ])
            )
        ])
    )

def get_currently_playing(config):
    refresh_token = config.get("auth")

    if refresh_token:
        refresh_token_hash = hash.sha256(refresh_token)
        access_token = cache.get(refresh_token_hash)

        if access_token == None:
            access_token = get_access_token(refresh_token)

        res = http.get(
            url = "https://api.spotify.com/v1/me/player/currently-playing",
            headers = {
                "Accept": "application/json",
                "Authorization": "Bearer %s" % access_token,
            },
        )

        if res.status_code != 200:
            fail("currently playing request failed with status code: %d" %
                (res.status_code))

        body = res.json()
    else:
        body = json.decode(EXAMPLE_DATA)
    return body

def oauth_handler(params):
    params = json.decode(params)

    res = http.post(
        url = "https://accounts.spotify.com/api/token",
        headers = {
            "Accept": "application/json",
            "Authorization": "Basic " + base64.encode(SPOTIFY_CLIENT_ID + ":" + SPOTIFY_CLIENT_SECRET),
        },
        form_body = dict(
            params,
        ),
        form_encoding = "application/x-www-form-urlencoded",
    )
    if res.status_code != 200:
        fail("token request failed with status code: %d - %s" %
             (res.status_code, res.body()))

    token_params = res.json()
    refresh_token = token_params["refresh_token"]
    return refresh_token

def get_access_token(refresh_token):
    res = http.post(
        url = "https://accounts.spotify.com/api/token",
        headers = {
            "Accept": "application/json",
            "Authorization": "Basic " + base64.encode(SPOTIFY_CLIENT_ID + ":" + SPOTIFY_CLIENT_SECRET),
        },
        form_body = dict(
            refresh_token = refresh_token,
            grant_type = "refresh_token",
            client_id = SPOTIFY_CLIENT_ID,
        ),
        form_encoding = "application/x-www-form-urlencoded",
    )
    if res.status_code != 200:
        fail("token request failed with status code: %d - %s" %
             (res.status_code, res.body()))

    token_params = res.json()
    access_token = token_params["access_token"]

    refresh_token_hash = hash.sha256(refresh_token)
    cache.set(refresh_token_hash, access_token, ttl_seconds = int(token_params["expires_in"] - 30))

    return access_token


def get_schema():
    return schema.Schema(
        version = "1",
        fields = [
            schema.OAuth2(
                id = "auth",
                icon = "cloud",
                name = "Spotify",
                desc = "Connect your Spotify account.",
                handler = oauth_handler,
                client_id = SPOTIFY_CLIENT_ID,
                authorization_endpoint = "https://accounts.spotify.com/authorize",
                scopes = [
                    "user-read-currently-playing",
                ],
            ),
        ],
    )

def cal_average(num):
    sum_num = 0
    for t in num:
        sum_num = sum_num + t           

    avg = sum_num / len(num)
    return avg

EXAMPLE_DATA = """
{
	"is_playing": true,
	"timestamp": 1755572339471,
	"context": {
		"external_urls": {
			"spotify": "https://open.spotify.com/album/67AAnBLQfoNPbHLdtJHa6Q"
		},
		"href": "https://api.spotify.com/v1/albums/67AAnBLQfoNPbHLdtJHa6Q",
		"type": "album",
		"uri": "spotify:album:67AAnBLQfoNPbHLdtJHa6Q"
	},
	"progress_ms": 136884,
	"item": {
		"album": {
			"album_type": "single",
			"artists": [
				{
					"external_urls": {
						"spotify": "https://open.spotify.com/artist/5Pb27ujIyYb33zBqVysBkj"
					},
					"href": "https://api.spotify.com/v1/artists/5Pb27ujIyYb33zBqVysBkj",
					"id": "5Pb27ujIyYb33zBqVysBkj",
					"name": "RÜFÜS DU SOL",
					"type": "artist",
					"uri": "spotify:artist:5Pb27ujIyYb33zBqVysBkj"
				}
			],
			"external_urls": {
				"spotify": "https://open.spotify.com/album/67AAnBLQfoNPbHLdtJHa6Q"
			},
			"href": "https://api.spotify.com/v1/albums/67AAnBLQfoNPbHLdtJHa6Q",
			"id": "67AAnBLQfoNPbHLdtJHa6Q",
			"images": [
				{
					"height": 640,
					"url": "https://i.scdn.co/image/ab67616d0000b273b0ce5cacc1047fe929e8f7e7",
					"width": 640
				},
				{
					"height": 300,
					"url": "https://i.scdn.co/image/ab67616d00001e02b0ce5cacc1047fe929e8f7e7",
					"width": 300
				},
				{
					"height": 64,
					"url": "https://i.scdn.co/image/ab67616d00004851b0ce5cacc1047fe929e8f7e7",
					"width": 64
				}
			],
			"name": "On My Knees",
			"release_date": "2021-09-23",
			"release_date_precision": "day",
			"total_tracks": 3,
			"type": "album",
			"uri": "spotify:album:67AAnBLQfoNPbHLdtJHa6Q"
		},
		"artists": [
			{
				"external_urls": {
					"spotify": "https://open.spotify.com/artist/5Pb27ujIyYb33zBqVysBkj"
				},
				"href": "https://api.spotify.com/v1/artists/5Pb27ujIyYb33zBqVysBkj",
				"id": "5Pb27ujIyYb33zBqVysBkj",
				"name": "RÜFÜS DU SOL",
				"type": "artist",
				"uri": "spotify:artist:5Pb27ujIyYb33zBqVysBkj"
			}
		],
		"disc_number": 1,
		"duration_ms": 334754,
		"explicit": false,
		"external_ids": {
			"isrc": "USRE12100559"
		},
		"external_urls": {
			"spotify": "https://open.spotify.com/track/58EEeLOoXMXl79bmnRw29w"
		},
		"href": "https://api.spotify.com/v1/tracks/58EEeLOoXMXl79bmnRw29w",
		"id": "58EEeLOoXMXl79bmnRw29w",
		"is_local": false,
		"name": "Alive",
		"popularity": 29,
		"preview_url": null,
		"track_number": 3,
		"type": "track",
		"uri": "spotify:track:58EEeLOoXMXl79bmnRw29w"
	},
	"currently_playing_type": "track",
	"actions": {
		"disallows": {
			"resuming": true
		}
	}
}
"""