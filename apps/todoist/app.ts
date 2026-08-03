/**
 * Todoist — hand port of `todoist/todoist.star` (by zephyern): the number
 * of tasks matching a filter (default "today | overdue").
 *
 * Auth: the original used Tidbyt's shared OAuth client (encrypted for
 * Tidbyt's KMS, undecryptable here); this port takes a personal API token
 * instead (Todoist Settings -> Integrations -> Developer), which the
 * original also accepted via its `dev_api_key` escape hatch.
 *
 * Screen sizes: the name marquee width follows the canvas.
 */

import {
  Box,
  Column,
  Config,
  Image,
  Marquee,
  Root,
  Row,
  Text,
  schema,
  type RootSpec,
  type Schema,
} from "@koiosdigital/matrx-sdk";
import { http } from "@koiosdigital/matrx-sdk/stdlib";

import TODOIST_ICON from "./logo.png";

const DEFAULT_NAME = "Todoist";
const DEFAULT_FILTER = "today | overdue";
const NO_TASKS_CONTENT = "No Tasks :)";
const TODOIST_URL = "https://api.todoist.com/rest/v2/tasks";
const DATA_TTL_SECONDS = 60;

export default async function render(config: Config): Promise<RootSpec | null> {
  const token = config.get("api_token");

  let filterName: string;
  let content: string;
  if (token) {
    filterName = config.get("name") || DEFAULT_NAME;
    const filter = config.get("filter") || DEFAULT_FILTER;

    const rep = await http.get(TODOIST_URL, {
      headers: { Authorization: `Bearer ${token}` },
      params: { filter },
      ttlSeconds: DATA_TTL_SECONDS,
    });

    let numTasks: number;
    if (rep.status === 200) {
      numTasks = (rep.json() as unknown[]).length;
    } else if (rep.status === 204) {
      numTasks = 0;
    } else {
      numTasks = -1;
    }

    if (numTasks === -1) {
      content = "Error";
    } else if (numTasks === 0) {
      content = NO_TASKS_CONTENT;
    } else {
      content = `${numTasks} Task${numTasks === 1 ? "" : "s"}`;
    }

    if (content === NO_TASKS_CONTENT && !config.bool("show", true)) {
      // Don't display the app in the user's rotation.
      return null;
    }
  } else {
    // Preview when no token is configured.
    filterName = "Todoist";
    content = "4 Tasks";
  }

  const nameWidth = config.width() - 24;

  return Root({
    delay: 500,
    maxAge: 86400,
    child: Box({
      child: Row({
        expanded: true,
        mainAlign: "space_evenly",
        crossAlign: "center",
        children: [
          Image({ src: TODOIST_ICON }),
          Column({
            children: [
              Marquee({ child: Text({ content: filterName }), width: nameWidth }),
              Text({ content }),
            ],
          }),
        ],
      }),
    }),
  });
}

export function getSchema(): Schema {
  return schema.schema({
    version: "1",
    fields: [
      schema.text({
        id: "api_token",
        name: "API Token",
        desc: "Todoist personal API token (Settings -> Integrations -> Developer).",
        icon: "key",
      }),
      schema.text({
        id: "name",
        name: "Name",
        desc: "Name to display",
        icon: "iCursor",
        default: DEFAULT_NAME,
      }),
      schema.text({
        id: "filter",
        name: "Filter",
        desc: "Filter to apply to tasks.",
        icon: "filter",
        default: DEFAULT_FILTER,
      }),
      schema.toggle({
        id: "show",
        name: "Show When No Tasks",
        desc: "Show this app when there are no tasks.",
        icon: "eye",
        default: true,
      }),
    ],
  });
}
