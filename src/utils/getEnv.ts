import { assertIsDefined } from './general'

export const getEnv = (arg: string | undefined) => {
	assertIsDefined<string | undefined>(arg)
	return arg
}
