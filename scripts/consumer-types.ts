/** Strict external consumer fixture; this file does not access profile data. */
import {Config,selected,type ArchiveConfig,type ArchiveStatus} from 'dsh-qq-archive'
import Control,{Config as ControlConfig,type ControlConfig as ControlSettings} from 'dsh-qq-archive/control'
import type {InboundMessage} from 'dsh-im-kit'
const config=(value:ArchiveConfig):ArchiveConfig=>Config(value)
const settings=(value:ControlSettings):ControlSettings=>ControlConfig(value)
const readStatus=(status:ArchiveStatus):number=>status.stored
const choose:typeof selected=selected
const consumer=(message:InboundMessage):InboundMessage=>message
export {config,settings,readStatus,choose,consumer,Control}
