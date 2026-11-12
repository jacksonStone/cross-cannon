import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  workReaderAction,
  workReaderLoader,
} from "~/features/work-reader/route.server";
export const churchFathersLoader = (args: LoaderFunctionArgs) =>
  workReaderLoader(args, "fathers");
export const churchFathersAction = (args: ActionFunctionArgs) =>
  workReaderAction(args, "fathers");
