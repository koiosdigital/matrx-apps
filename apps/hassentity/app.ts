/**
 * Hass Entity — hand port of `hassentity/hass_entity.star` (by
 * InTheDaylight14): shows a Home Assistant entity's state (or one
 * attribute) via the Nabu Casa remote URL and a long-lived access token.
 *
 * Egress: `*.ui.nabu.casa` is wildcard-allowlisted, which is why this app
 * ports cleanly while arbitrary-host apps (e.g. octoprint) can't.
 *
 * Screen sizes: header/value widths and the vertical marquee height derive
 * from the canvas.
 */

import {
  Box,
  Column,
  Config,
  Marquee,
  Root,
  WrappedText,
  schema,
  type RootSpec,
  type Schema,
} from "@koiosdigital/matrx-sdk";
import { http } from "@koiosdigital/matrx-sdk/stdlib";

const DEFAULT_COLOR = "#aaaaaa";
const DATA_TTL_SECONDS = 6;

interface EntityState {
  state: string;
  attributes: Record<string, unknown> & { friendly_name?: string; unit_of_measurement?: string };
}

const SAMPLE_DATA: EntityState = {
  state: "off",
  attributes: { friendly_name: "Front Door" },
};

async function getEntityState(config: Config): Promise<EntityState | null> {
  const urlKey = config.get("nabu_casa_url_key", "")!;
  const token = config.get("token", "")!;
  const entityName = config.get("entity_name", "")!;
  if (!urlKey || !token || !entityName) return null;

  const res = await http.get(`https://${urlKey}.ui.nabu.casa/api/states/${entityName}`, {
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    ttlSeconds: DATA_TTL_SECONDS,
  });
  if (res.status !== 200) {
    throw new Error(`HA Rest API request failed with status code: ${res.status} - ${res.body()}`);
  }
  return res.json() as EntityState;
}

export default async function render(config: Config): Promise<RootSpec> {
  const entityName = config.get("entity_name", "")!;
  const attribute = config.get("attribute", "")!;
  const width = config.width();
  const height = config.height();

  let states: EntityState;
  if (!entityName) {
    states = SAMPLE_DATA;
  } else {
    const fetched = await getEntityState(config);
    if (fetched === null) {
      states = SAMPLE_DATA;
    } else {
      states = fetched;
    }
  }

  const friendlyName =
    config.get("friendly_name", "") || states.attributes.friendly_name || entityName;

  let state = attribute ? String(states.attributes[attribute]) : states.state;
  if (states.attributes.unit_of_measurement !== undefined) {
    state += states.attributes.unit_of_measurement;
  }

  return Root({
    delay: 6000,
    child: Column({
      children: [
        WrappedText({
          content: friendlyName,
          color: config.get("header_color", DEFAULT_COLOR),
          lineSpacing: 0,
          width,
        }),
        Box({ height: 1, width, color: config.get("separator_color", DEFAULT_COLOR) }),
        Marquee({
          height: height - 9,
          offsetStart: 10,
          offsetEnd: 10,
          scrollDirection: "vertical",
          child: WrappedText({
            content: state,
            width,
            color: config.get("value_color", DEFAULT_COLOR),
          }),
        }),
      ],
    }),
  });
}

export function getSchema(): Schema {
  const colorField = (id: string, name: string) =>
    schema.color({
      id,
      name,
      desc: `Provide a hex code for the ${name.toLowerCase()} Ex. #ff00ff`,
      icon: "palette",
      default: DEFAULT_COLOR,
      palette: [DEFAULT_COLOR],
    });

  return schema.schema({
    version: "1",
    fields: [
      schema.text({
        id: "nabu_casa_url_key",
        name: "Nabu Casa Url Key",
        desc: "The random letters and numbers in your Nabu Casa URL. Ex. Input 'abc123' for https://abc123.ui.nabu.casa",
        icon: "link",
      }),
      schema.text({
        id: "token",
        name: "Long-Lived Token",
        desc: "Home Assistant Long-Lived Access Token. Profile -> Long-Lived Access Tokens -> Create Token",
        icon: "key",
      }),
      schema.text({
        id: "entity_name",
        name: "Entity Name",
        desc: "Entity name ex. 'sensor.front_door'",
        icon: "textHeight",
      }),
      schema.text({
        id: "attribute",
        name: "Attribute",
        desc: "Optionally show the value of an attribute for the entity",
        icon: "textHeight",
      }),
      schema.text({
        id: "friendly_name",
        name: "Name Override",
        desc: "Optionally override the entity friendly name",
        icon: "textHeight",
      }),
      colorField("header_color", "Header Color"),
      colorField("separator_color", "Separator Color"),
      colorField("value_color", "Value Color"),
    ],
  });
}
